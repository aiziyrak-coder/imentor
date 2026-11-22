import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2, Play, Users } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import { useUiText } from '../../i18n/useUiText';
import { controlMonitor, fetchHostMonitor, nextMonitorPollDelay, type HostMonitorState } from '../../utils/liveMonitorApi';
import { CountdownBar, MonitorStyles, secondsLeft, useServerNow } from './MonitorTimer';

/**
 * O'qituvchi monitori — jonli test monitor rejimi (2026-11-12).
 * 1) Kutish: QR, kim qo'shildi va kim "Tayyorman" bosdi; "Boshlash" faqat hamma tayyor bo'lsa (masalan 10/10).
 * 2) Test — to'liq ekran, INSON OMILISIZ: har savol 60 s o'qish + 60 s belgilash (savol doim ko'rinadi, ostida orqaga sanoq va
 *    qisqaruvchi chiziq), keyin 10 soniya "Javoblarni belgilang" (orqada katta 10…1), so'ng keyingisi o'zi.
 *    Keyingi, to'xtatish, orqaga — tugmalar yo'q.
 * 3) Oxirgi savoldan keyin test o'zi yopiladi va natijalar avtomatik ochiladi (`onAnalyze`).
 * Eski (monitorsiz) sessiya bo'lsa — `fallback`.
 */
type Props = {
  sessionKey: string;
  qr: ReactNode;
  fallback: ReactNode;
  finalizing: boolean;
  /** Test tugagach avtomatik chaqiriladi — natijalar va tahlil ochiladi. */
  onAnalyze: () => void;
};

const POLL_MS = 1000;
const HOST_POLL_OPTS = { lobbyMs: 1500, maxMs: 2000, jitterMs: 200 };
/**
 * Monitor shuncha vaqt serverdan yangi holat olmasa — ekranda katta ogohlantirish (2026-11-18).
 * Bugun 179 testning 19 tasida test ketayotganda monitor 20 s – 8 daqiqa jim qoldi (telefonlar ishlab turdi):
 * monitorda eski savol turdi, talabalar keyingi savollarni ko'rmasdan belgiladi. Ikkala so'rov (holat va
 * natijalar) birga to'xtagan — kompyuter uxlagan, ekran qulflangan, oyna yashirilgan yoki internet uzilgan.
 */
const STALE_MS = 12_000;
/** Monitor yozuvlari ekran o'lchamiga qarab (kichik projektordan 4K televizorgacha bir xil ko'rinish). */
const MON_HEAD = 'clamp(16px, min(1.6vw, 3vh), 44px)';
const MON_SMALL = 'clamp(13px, min(1.25vw, 2.4vh), 34px)';

export default function LiveMonitorHost({ sessionKey, qr, fallback, onAnalyze }: Props) {
  const { t } = useUiText();
  const [st, setSt] = useState<HostMonitorState | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [lastOkMs, setLastOkMs] = useState(() => Date.now());
  const boxRef = useRef<HTMLDivElement>(null);
  const analyzedRef = useRef(false);
  const now = useServerNow(offset);
  // Savol ekranga SIG'ISHI shart (2026-11-13: uzun klinik savolning pasti va taymer monitordan chiqib ketdi).
  // Eng katta o'lcham ekranning eni va BO'YIGA qarab olinadi (projektor, 4K televizor, past noutbuk ekrani),
  // so'ng savol bloki bo'sh joyga sig'adigan eng katta shrift ikkiga bo'lib qidiriladi. Blok o'lchami
  // o'zgarsa (to'liq ekran, oyna, aylantirish) yoki shriftlar kech yuklansa — qayta hisoblanadi.
  // Juda uzun matn eng kichik o'lchamda ham sig'masa — blok aylantiriladi (kesilib qolmaydi).
  const fitBoxRef = useRef<HTMLDivElement>(null);
  const fitInnerRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [fitOverflow, setFitOverflow] = useState(false);
  const running = st?.phase === 'running' && !st.is_closed;
  useEffect(() => {
    if (!running) return;
    const bump = () => setLayoutTick((v) => v + 1);
    window.addEventListener('resize', bump);
    document.addEventListener('fullscreenchange', bump);
    const box = fitBoxRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && box ? new ResizeObserver(bump) : null;
    if (ro && box) ro.observe(box);
    document.fonts?.ready.then(bump).catch(() => undefined);
    return () => {
      window.removeEventListener('resize', bump);
      document.removeEventListener('fullscreenchange', bump);
      ro?.disconnect();
    };
  }, [running]);
  const fitText = running ? `${st?.index}|${st?.stage}|${st?.question ?? ''}` : '';
  useLayoutEffect(() => {
    const box = fitBoxRef.current;
    const inner = fitInnerRef.current;
    const q = questionRef.current;
    if (!box || !inner || !q) return;
    const cs = window.getComputedStyle(box);
    const available = box.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    if (available <= 0) return; // joylashuv hali yo'q (masalan test muhiti)
    const max = Math.round(Math.max(24, Math.min(110, window.innerWidth * 0.036, window.innerHeight * 0.075)));
    const MIN = 14;
    const fits = (px: number) => {
      q.style.fontSize = `${px}px`;
      return inner.scrollHeight <= available && inner.scrollWidth <= inner.clientWidth + 1;
    };
    let best = MIN;
    if (fits(max)) best = max;
    else {
      let lo = MIN;
      let hi = max - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fits(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
    }
    const ok = fits(best);
    setFitOverflow(!ok);
  }, [fitText, layoutTick]);

  const apply = useCallback((next: HostMonitorState) => {
    setOffset(next.server_now_ms - Date.now());
    setLastOkMs(Date.now());
    setSt(next);
  }, []);

  // Monitor 2 soniyada bir so'raydi (javob berganlar soni uchun) va bosqich almashadigan lahzada
  // (2026-11-13 yuk hodisasi: ilgari har soniya). Test tugagach — bir marta, natijalar uchun.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let inFlight = false;
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, ms);
    };
    // Yashirin oynada ham so'raladi (sinfda bitta kompyuter — yuk sezilmaydi): ilgari yashirin paytda so'rov
    // to'xtardi va oyna qaytgach ham brauzer sekinlatgan taymerni kutardi.
    const tick = () => {
      if (!alive || inFlight) return;
      inFlight = true;
      fetchHostMonitor(sessionKey)
        .finally(() => { inFlight = false; })
        .then((r) => {
          if (!alive) return;
          apply(r);
          const next = nextMonitorPollDelay(
            { phase: r.phase, stage: r.stage, read_ends_at_ms: r.read_ends_at_ms, ends_at_ms: r.ends_at_ms,
              server_now_ms: r.server_now_ms, is_closed: r.is_closed },
            HOST_POLL_OPTS,
          );
          if (next !== null) schedule(next);
        })
        .catch((e) => {
          if (!alive) return;
          // Eski (monitorsiz) sessiya — avvalgi panel; so'rash TO'XTAYDI (ilgari har soniyada 404 so'rardi).
          if (e instanceof HttpError && e.status === 404) setLegacy(true);
          else schedule(POLL_MS * 2);
        });
    };
    // Oyna qayta ko'rindi yoki internet qaytdi — kutmasdan darhol yangilanadi.
    const wake = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, [sessionKey, apply]);

  // Test ketayotganda monitor ekrani o'chmasin va kompyuter uxlamasin (brauzer qo'llasa). Yashirilganda
  // brauzer qulfni o'zi bo'shatadi — oyna qaytganda qayta olinadi.
  useEffect(() => {
    if (!running) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const take = () => {
      if (document.hidden || !nav.wakeLock) return;
      nav.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => undefined);
    };
  }, [running]);

  const done = Boolean(st && (st.phase === 'done' || st.is_closed));
  // Oxirgi savoldan keyin: to'liq ekrandan chiqiladi va natijalar o'zi ochiladi (o'qituvchi bosmaydi).
  useEffect(() => {
    if (!done || analyzedRef.current) return;
    analyzedRef.current = true;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onAnalyze();
  }, [done, onAnalyze]);

  const start = async () => {
    setBusy(true);
    setError('');
    // To'liq ekran — tugma bosilgan zahoti (brauzer faqat foydalanuvchi harakatidan keyin ruxsat beradi).
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    try {
      apply(await controlMonitor(sessionKey, 'start'));
    } catch (e) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      const detail = e instanceof HttpError ? (e.body as { detail?: unknown } | null)?.detail : null;
      setError(typeof detail === 'string' ? detail : t('monitor.host.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (legacy) return <>{fallback}</>;
  if (!st) return <div className="py-8 text-center"><Loader2 className="mx-auto animate-spin text-blue-600" /></div>;

  if (st.phase === 'lobby' && !st.is_closed) {
    return (
      <div className="space-y-5" data-testid="monitor-host-lobby">
        {qr}
        <div className="space-y-4">
          <p className="text-[14px] leading-relaxed text-slate-600">{t('monitor.host.lobbyHint')}</p>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl bg-white px-5 py-3 ring-1 ring-slate-200">
              <p className="text-[12.5px] text-slate-500">{t('monitor.host.joined')}</p>
              <p className="text-[30px] font-bold tabular-nums text-slate-900">{st.joined}</p>
            </div>
            <div className={`rounded-2xl px-5 py-3 ring-1 ${st.can_start ? 'bg-emerald-50 ring-emerald-200' : 'bg-amber-50 ring-amber-200'}`}>
              <p className="text-[12.5px] text-slate-600">{t('monitor.host.ready')}</p>
              <p className="text-[30px] font-bold tabular-nums text-slate-900" data-testid="monitor-ready-count">
                {st.ready}/{st.joined}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void start()}
            disabled={!st.can_start || busy}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-8 py-4 text-[18px] font-bold text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {busy ? <Loader2 size={22} className="animate-spin" /> : <Play size={22} />}
            {t('monitor.host.start')}
          </button>
          {!st.can_start && (
            <p className="text-[13px] text-slate-500">
              {st.joined === 0 ? t('monitor.host.waitJoin') : t('monitor.host.waitReady', { left: String(st.joined - st.ready) })}
            </p>
          )}
          {error && <p className="text-[13px] text-rose-600">{error}</p>}
          {st.people.length > 0 && (
            <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {st.people.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[13px] ring-1 ring-slate-200">
                  <span className="truncate font-medium text-slate-800">{p.name}</span>
                  {p.ready ? <Check size={16} className="shrink-0 text-emerald-600" /> : <span className="shrink-0 text-[11.5px] text-amber-700">{t('monitor.host.notReady')}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4" data-testid="monitor-host-done">
        <Loader2 size={22} className="animate-spin text-emerald-700" />
        <p className="text-[15px] font-semibold text-emerald-900">{t('monitor.host.finishing')}</p>
      </div>
    );
  }

  // ---------------------------------------------------------------- test ketmoqda — to'liq ekran
  const readEnds = st.read_ends_at_ms ?? 0;
  const ends = st.ends_at_ms ?? 0;
  const readStart = readEnds - st.read_seconds * 1000;
  const answering = st.stage === 'answer';
  const readLeft = secondsLeft(readEnds, now);
  const answerLeft = secondsLeft(ends, now);
  const stale = now - offset - lastOkMs > STALE_MS;
  return (
    <div
      ref={boxRef}
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-gradient-to-b from-slate-50 to-white"
      data-testid="monitor-host-running"
    >
      <MonitorStyles />
      {stale && (
        <div
          role="alert"
          data-testid="monitor-host-offline"
          className="shrink-0 bg-rose-600 px-[3vw] py-[1.2vh] text-center font-bold text-white"
          style={{ fontSize: MON_HEAD }}
        >
          {t('monitor.host.offline')}
        </div>
      )}
      <div className="flex shrink-0 items-center gap-[2vw] px-[3vw] pt-[2.2vh]">
        <span className="shrink-0 whitespace-nowrap rounded-2xl bg-slate-900 px-[1.2em] py-[0.35em] font-bold text-white" style={{ fontSize: MON_HEAD }}>
          {t('monitor.host.questionOf', { n: String(st.index + 1), total: String(st.total) })}
        </span>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {Array.from({ length: st.total }, (_, i) => (
            <span key={i} className={`h-2.5 flex-1 rounded-full transition-colors duration-500 ${
              i < st.index ? 'bg-emerald-500' : i === st.index ? 'bg-blue-600' : 'bg-slate-200'
            }`}
            />
          ))}
        </div>
        <span className="flex shrink-0 items-center gap-[0.4em] whitespace-nowrap text-slate-600" style={{ fontSize: MON_SMALL }}>
          <Users className="h-[1.1em] w-[1.1em]" /> {t('monitor.host.answered', { n: String(st.answered_current), total: String(st.joined) })}
        </span>
      </div>

      <div ref={fitBoxRef} className={`relative flex min-h-0 flex-1 flex-col gap-6 px-[3vw] py-[2.5vh] ${fitOverflow ? 'justify-start overflow-y-auto' : 'justify-center overflow-hidden'}`}>
        {/* Monitorda FAQAT savol (2026-11-12): variantlar ko'rsatilmaydi — ular 10 soniyalik belgilash
            bosqichida faqat talabalar telefonida chiqadi. */}
        <div key={st.index} ref={fitInnerRef} className="im-mon-in min-w-0 space-y-[2.5vh]">
          <p ref={questionRef} className="whitespace-pre-line font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]" style={{ fontSize: 48 }} data-testid="monitor-question">
            {st.question}
          </p>
          {!answering && (
            <p className="text-slate-500" style={{ fontSize: MON_SMALL }} data-testid="monitor-read-hint">
              {t('monitor.host.optionsOnPhones', { seconds: String(st.answer_seconds) })}
            </p>
          )}
        </div>

      </div>

      <div className="shrink-0 space-y-[1.2vh] px-[3vw] pb-[3vh]">
        {answering ? (
          // Belgilash (2026-11-13): savol ekranda TO'LIQ ko'rinib turadi — taymer endi uni to'smaydi, pastki
          // qatorda: qizil "Javoblarni belgilang!" va katta teskari sanoq, ostida qisqaruvchi chiziq.
          <>
            <div className="flex items-center justify-between gap-[2vw]" data-testid="monitor-mark-now">
              <span className="im-mon-pulse rounded-2xl bg-rose-600 px-[1em] py-[0.3em] font-extrabold text-white shadow-lg" style={{ fontSize: 'clamp(18px, min(2.6vw, 4.6vh), 64px)' }}>
                {t('monitor.host.markNow')}
              </span>
              <span
                key={answerLeft}
                style={{ fontSize: 'clamp(32px, min(5vw, 9vh), 140px)' }}
                className={`im-mon-pop font-black leading-none tabular-nums ${answerLeft <= 5 ? 'text-rose-600' : answerLeft <= 10 ? 'text-amber-500' : 'text-slate-900'}`}
                data-testid="monitor-answer-seconds"
              >
                {answerLeft}
              </span>
            </div>
            <CountdownBar key={`a-${st.index}`} startMs={readEnds} endMs={ends} offsetMs={offset} tone="short" height="clamp(10px, 2vh, 28px)" testId="monitor-bar" />
          </>
        ) : (
          <>
            <div className="flex items-end justify-between">
              <span className="text-slate-500" style={{ fontSize: MON_SMALL }}>{t('monitor.host.readHint', { seconds: String(st.answer_seconds) })}</span>
              <span
                key={readLeft}
                style={{ fontSize: 'clamp(32px, min(5vw, 9vh), 140px)' }}
                className={`im-mon-pop font-black leading-none tabular-nums ${readLeft <= 5 ? 'text-rose-600' : readLeft <= 10 ? 'text-amber-500' : 'text-slate-900'}`}
                data-testid="monitor-seconds"
              >
                {readLeft}
              </span>
            </div>
            <CountdownBar key={`r-${st.index}`} startMs={readStart} endMs={readEnds} offsetMs={offset} tone="long" height="clamp(10px, 2vh, 28px)" testId="monitor-bar" />
          </>
        )}
      </div>
    </div>
  );
}
