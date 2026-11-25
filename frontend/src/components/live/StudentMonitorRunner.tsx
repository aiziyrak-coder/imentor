import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Hand, Loader2, MonitorPlay } from 'lucide-react';
import type { AppLanguage } from '../../i18n/language';
import { useTranslate } from '../../i18n/useUiText';
import { HttpError } from '../../api/httpClient';
import { markAutoReloadSafe } from '../../utils/autoReloadGate';
import { bindLiveTestVisibilityTracking, flushLiveTestEvents } from '../../utils/liveTestAnticheat';
import {
  OPTION_LETTERS,
  answerMonitor,
  fetchStudentMonitor,
  joinMonitor,
  markReady,
  nextStudentPollDelay,
  ANSWER_GRACE_MS,
  pollRetryDelay,
  type StudentMonitorState,
} from '../../utils/liveMonitorApi';
import { CountdownBar, MonitorStyles, secondsLeft, useServerNow } from './MonitorTimer';

/**
 * Talaba telefoni — monitor rejimi (2026-11-12). Savol MATNI faqat monitorda; telefonda joriy savolning
 * variantlari. Har savol: 40 soniya o'qish (variantlar ko'rinadi, lekin hali bosilmaydi), keyin 10 soniya
 * "Javobni belgilang!" — shu vaqtda bosiladi; ulgurmagan — xato. Keyingi savol o'zi keladi (so'rov bosqich chegarasida).
 */
type Props = {
  sessionKey: string;
  participantKey: string;
  firstName: string;
  lastName: string;
  lang: AppLanguage;
  topic: string;
  /** Test tugadi — sahifa natijani kutishga o'tadi (test o'zi yopilgach natija chiqadi). */
  onDone: () => void;
};

const POLL_OPTS = { lobbyMs: 2500, maxMs: 5000, jitterMs: 500 };
const POLL_RETRY_MS = 2000;
const POLL_HIDDEN_MS = 3000;

export default function StudentMonitorRunner({ sessionKey, participantKey, firstName, lastName, lang, topic, onDone }: Props) {
  const ts = useTranslate(lang);
  const [st, setSt] = useState<StudentMonitorState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ index: number; option: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const doneRef = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const now = useServerNow(offset);
  const who = { participantKey, firstName, lastName };

  // Joriy savol variantlari (belgilashda yoki o'qish oxirida OLDINDAN kelgan) — so'rov kechiksa ham
  // belgilash o'z vaqtida ochiladi. Ekranda faqat belgilash boshlanganda ko'rinadi.
  const [held, setHeld] = useState<{ index: number; options: string[] } | null>(null);
  const heldRef = useRef<{ index: number; options: string[] } | null>(null);

  const offsetRef = useRef(0);

  const apply = useCallback((next: StudentMonitorState) => {
    offsetRef.current = next.server_now_ms - Date.now();
    setOffset(next.server_now_ms - Date.now());
    setSt(next);
    const opts = next.options?.length ? next.options : next.next_options;
    if (next.phase === 'running' && opts && opts.length) {
      const h = { index: next.index, options: opts };
      heldRef.current = h;
      setHeld(h);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    joinMonitor(sessionKey, who)
      .then((r) => { if (alive) { apply(r); setError(''); } })
      .catch(() => { if (alive) setError(ts('monitor.student.joinFailed')); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, participantKey]);

  // So'rov har soniya EMAS: bosqich almashadigan lahzada (+ tasodifiy 0,1–0,6 s) va oraliqda zaxira
  // uchun 5 soniyada bir (`nextMonitorPollDelay`, 2026-11-13 yuk hodisasi). Javob yuborilganda ham
  // holat keladi. Test tugagach so'rash to'xtaydi.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let failures = 0;
    const schedule = (ms: number) => { timer = window.setTimeout(tick, ms); };
    const tick = () => {
      if (!alive) return;
      if (document.hidden) { schedule(POLL_HIDDEN_MS); return; }
      fetchStudentMonitor(sessionKey, participantKey)
        .then((r) => {
          if (!alive) return;
          failures = 0;
          apply(r);
          const have = Boolean(heldRef.current && heldRef.current.index === r.index);
          const next = nextStudentPollDelay(r, have);
          if (next !== null) schedule(next);
        })
        // Test ketayotganda tez qayta urinish (variantlar kechikmasin), lekin ketma-ket xatoda tobora sekinroq —
        // band serverni yuzlab telefon yanada bosib qo'ymasin. Kutish zalida — sekinroq.
        .catch(() => {
          if (!alive) return;
          failures += 1;
          schedule(heldRef.current ? pollRetryDelay(failures) : POLL_RETRY_MS);
        });
    };
    schedule(POLL_OPTS.lobbyMs);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [sessionKey, participantKey, apply]);

  // Savol almashganda eski xato yozuvi va tanlov tozalanadi.
  // Kutish zalida (test hali boshlanmagan, so'rov yo'q) — yangi versiya chiqsa sahifa o'zi yangilanishi
  // mumkin; test boshlangach — yo'q. Sessiya URL'da, ishtirokchi kaliti saqlangan: yangilangach o'zi qaytadi.
  const lobbyIdle = st?.phase === 'lobby' && !busy;
  useEffect(() => {
    markAutoReloadSafe(`monitor-student:${sessionKey}`, lobbyIdle);
    return () => markAutoReloadSafe(`monitor-student:${sessionKey}`, false);
  }, [lobbyIdle, sessionKey]);

  const index = st?.index ?? -1;
  useEffect(() => {
    setError('');
  }, [index]);

  const running = st?.phase === 'running' && !st.submitted;
  // Belgilash boshlanganda taymer va variantlar ko'rinishga keladi (kichik telefonda sahifa pastga
  // aylantirilgan bo'lsa ham variantlar ekrandan tashqarida qolmasin).
  // Belgilash bosqichi TELEFON SOATI bilan: o'qish tugadi va variantlar qo'lda bo'lsa — darhol ochiladi,
  // keyingi so'rovni kutmaydi (server ham shu vaqtni belgilash deb biladi; 2 s tarmoq zaxirasi bor).
  const readEndsMs = st?.read_ends_at_ms ?? 0;
  const endsMs = st?.ends_at_ms ?? 0;
  const paused = Boolean(running && st?.paused);
  const localAnswering = Boolean(
    st && running && !paused && endsMs && now < endsMs
      && (st.stage === 'answer' || (held !== null && held.index === st.index && readEndsMs && now >= readEndsMs)),
  );
  const answerKey = localAnswering && st ? st.index : -1;
  useEffect(() => {
    if (answerKey < 0) return;
    const el = topRef.current;
    if (el && typeof el.scrollIntoView === 'function' && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [answerKey]);
  // Test paytida sahifadan chiqish tahlil uchun qayd etiladi; ekran o'chmaydi.
  useEffect(() => {
    if (!running) return;
    const stop = bindLiveTestVisibilityTracking(sessionKey, () => {
      void flushLiveTestEvents(sessionKey, participantKey).catch(() => undefined);
    });
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    return () => {
      stop();
      void flushLiveTestEvents(sessionKey, participantKey).catch(() => undefined);
      void lock?.release().catch(() => undefined);
    };
  }, [running, sessionKey, participantKey]);

  useEffect(() => {
    if (!doneRef.current && st && (st.phase === 'done' || st.submitted)) {
      doneRef.current = true;
      onDone();
    }
  }, [st, onDone]);

  const ready = async () => {
    setBusy(true);
    try {
      apply(await markReady(sessionKey, who));
      setError('');
    } catch {
      setError(ts('monitor.student.failed'));
    } finally {
      setBusy(false);
    }
  };

  // Javoblar NAVBAT bilan yuboriladi (2026-11-17 audit): tez-tez bosilganda so'rovlar ustma-ust ketib, server
  // eski tanlovni oxirgi bo'lib saqlashi yoki ekranda eski javob ko'rinishi mumkin edi. Bir vaqtda bitta so'rov;
  // oraliqda bosilgan OXIRGI variant undan keyin yuboriladi.
  const queuedRef = useRef<{ index: number; option: number; deadline: number } | null>(null);
  const sendingRef = useRef(false);

  const sendOne = async (job: { index: number; option: number; deadline: number }) => {
    // Tarmoq qotsa yoki server band bo'lsa — server qabul qiladigan muddat tugaguncha yana urinadi (server 409
    // bersa — kech, qayta urinilmaydi). Bir xil javobni qayta yuborish xavfsiz: server shunchaki qayta yozadi.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await answerMonitor(sessionKey, participantKey, job.index, job.option);
      } catch (e) {
        const late = e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429;
        if (late || Date.now() + offsetRef.current > job.deadline) break;
        await new Promise((r) => window.setTimeout(r, 300 + attempt * 400));
        if (Date.now() + offsetRef.current > job.deadline) break;
      }
    }
    return null;
  };

  const choose = async (option: number) => {
    if (!st || st.phase !== 'running' || !localAnswering) return;
    queuedRef.current = { index: st.index, option, deadline: (st.ends_at_ms ?? 0) + ANSWER_GRACE_MS };
    setPicked({ index: st.index, option });
    setError('');
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      while (queuedRef.current) {
        const job = queuedRef.current;
        queuedRef.current = null;
        const view = await sendOne(job);
        if (queuedRef.current) continue; // yangi tanlov kutyapti — oraliq javob ko'rsatilmaydi
        if (view) {
          apply(view);
        } else {
          setPicked((p) => (p && p.index === job.index ? null : p));
          setError(ts('monitor.student.answerLate'));
        }
      }
    } finally {
      sendingRef.current = false;
    }
  };

  if (!st) {
    return (
      <div className="py-12 text-center">
        {error ? <p className="text-[14px] text-rose-600">{error}</p> : <Loader2 className="mx-auto animate-spin text-blue-600" />}
      </div>
    );
  }

  if (st.phase === 'done' || st.submitted) {
    return (
      <div className="space-y-3 rounded-2xl bg-white px-5 py-8 text-center ring-1 ring-slate-900/[0.06]" data-testid="monitor-done">
        <Check size={36} className="mx-auto text-emerald-600" />
        <p className="text-[17px] font-bold text-slate-900">{ts('monitor.student.doneTitle')}</p>
        <p className="text-[13.5px] text-slate-500">{ts('monitor.student.resultSoon')}</p>
      </div>
    );
  }

  if (st.phase === 'lobby') {
    return (
      <div className="space-y-4 rounded-2xl bg-white px-5 py-7 text-center ring-1 ring-slate-900/[0.06]" data-testid="monitor-lobby">
        <p className="text-[15px] font-semibold text-slate-900 [overflow-wrap:anywhere]">{topic}</p>
        <p className="text-[13.5px] leading-relaxed text-slate-600">
          {ts('monitor.student.rules', { count: String(st.total), read: String(st.read_seconds), answer: String(st.answer_seconds) })}
        </p>
        {st.ready ? (
          <div className="rounded-xl bg-emerald-50 px-4 py-4 text-emerald-800">
            <Check size={26} className="mx-auto" />
            <p className="mt-1 text-[15px] font-semibold">{ts('monitor.student.readyDone')}</p>
            <p className="text-[13px] text-emerald-700/80">{ts('monitor.student.waitStart')}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void ready()}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-[18px] font-bold text-white shadow-md disabled:opacity-60"
          >
            {busy ? <Loader2 size={20} className="animate-spin" /> : <Hand size={22} />}
            {ts('monitor.student.readyButton')}
          </button>
        )}
        {error && <p className="text-[13px] text-rose-600">{error}</p>}
      </div>
    );
  }

  if (paused) {
    // Monitor (savol ekrani) aloqasi uzilgan: savolni ko'rmasdan belgilab bo'lmaydi — test kutadi (2026-11-25).
    return (
      <div className="space-y-3 rounded-2xl bg-amber-50 px-5 py-8 text-center ring-1 ring-amber-200" data-testid="monitor-paused">
        <Loader2 size={36} className="mx-auto animate-spin text-amber-600" />
        <p className="text-[clamp(17px,5.5vw,20px)] font-bold leading-snug text-slate-900">{ts('monitor.student.pausedTitle')}</p>
        <p className="text-[13.5px] leading-relaxed text-slate-600">
          {ts('monitor.student.pausedHint', { n: String(st.index + 1) })}
        </p>
      </div>
    );
  }

  const readEnds = st.read_ends_at_ms ?? 0;
  const ends = st.ends_at_ms ?? 0;
  const answering = localAnswering;
  const shownOptions = st.options.length ? st.options : (held && held.index === st.index ? held.options : []);
  const left = answering ? secondsLeft(ends, now) : secondsLeft(readEnds, now);
  const mine = picked && picked.index === st.index ? picked.option : st.my_answer;

  return (
    <div ref={topRef} className="min-w-0 scroll-mt-3 space-y-4" data-testid="monitor-running">
      <MonitorStyles />
      <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-900/[0.06]">
        <span className="min-w-0 text-[15px] font-semibold text-slate-800">
          {ts('monitor.student.questionOf', { n: String(st.index + 1), total: String(st.total) })}
        </span>
        <span key={left} className={`im-mon-pop text-[26px] font-black tabular-nums ${answering || left <= 5 ? 'text-rose-600' : 'text-slate-900'}`}>
          {left}
        </span>
      </div>

      {answering ? (
        <>
          <div className="im-mon-in space-y-2" data-testid="student-mark-now">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-600 px-4 py-2 text-white shadow-lg">
              <span className="im-mon-pulse min-w-0 text-[clamp(15px,5vw,19px)] font-extrabold leading-tight">{ts('monitor.student.markNow')}</span>
              {/* Katta teskari taymer — belgilash vaqti (15…1). */}
              <span key={left} className="im-mon-pop shrink-0 text-[44px] font-black leading-none tabular-nums" data-testid="student-answer-seconds">
                {left}
              </span>
            </div>
            <CountdownBar key={`a-${st.index}`} startMs={readEnds} endMs={ends} offsetMs={offset} tone="short" height={12} />
          </div>
          {/* Variantlar FAQAT 10 soniyalik belgilash bosqichida (server ham faqat shu paytda yuboradi). */}
          <div key={st.index} className="im-mon-in grid gap-2.5" data-testid="student-options">
            {shownOptions.map((text, i) => (
              <button
                key={`${st.index}-${i}`}
                type="button"
                onClick={() => void choose(i)}
                className={`flex w-full min-w-0 items-start gap-3 rounded-2xl px-4 py-3.5 text-left text-[15px] ring-1 transition active:scale-[0.98] ${
                  mine === i ? 'bg-blue-600 text-white ring-blue-600' : 'im-mon-glow bg-white text-slate-900 ring-rose-300'
                }`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${
                  mine === i ? 'bg-white text-blue-700' : 'bg-slate-100 text-slate-700'
                }`}
                >
                  {OPTION_LETTERS[i]}
                </span>
                <span className="min-w-0 select-none whitespace-pre-line pt-0.5 leading-snug [overflow-wrap:anywhere]">{text}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-[12.5px] text-slate-500">
            {mine >= 0 ? ts('monitor.student.answered') : ts('monitor.student.missWarn')}
          </p>
        </>
      ) : (
        // O'qish vaqtida (60 s): telefonda variant YO'Q — faqat monitorga qarab savolni o'qish.
        <div className="im-mon-in space-y-4 rounded-2xl bg-white px-5 py-8 text-center ring-1 ring-slate-900/[0.06]" data-testid="student-read">
          <MonitorPlay size={44} className="mx-auto text-blue-600" />
          <p className="text-[clamp(17px,5.5vw,20px)] font-bold leading-snug text-slate-900">{ts('monitor.student.lookAtMonitor')}</p>
          <p className="text-[13.5px] text-slate-500">{ts('monitor.student.readStage', { seconds: String(st.answer_seconds) })}</p>
          <CountdownBar key={`r-${st.index}`} startMs={readEnds - st.read_seconds * 1000} endMs={readEnds} offsetMs={offset} tone="long" height={10} />
        </div>
      )}
      {error && <p className="text-center text-[13px] text-rose-600">{error}</p>}
    </div>
  );
}
