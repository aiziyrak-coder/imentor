/**
 * Monitor rejimini ko'z bilan tekshirish (`harness.html?monitor=1`, faqat `npm run dev`; ishlab chiqarishga kirmaydi).
 * Haqiqiy komponentlar — o'qituvchi monitori va talaba telefoni yonma-yon — soxta server bilan: server qoidalari
 * (40 s o'qish + 15 s belgilash, faqat belgilash vaqtida javob, oxirida avtomatik yopilish) shu yerda takrorlanadi.
 * `?monitor=1&fast=1` — 8 s + 4 s (tez ko'rish uchun).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppLanguageContext } from '../App';
import LiveMonitorHost from '../components/live/LiveMonitorHost';
import StudentMonitorRunner from '../components/live/StudentMonitorRunner';

const params = new URLSearchParams(location.search);
const FAST = params.get('fast') === '1';
const READ = FAST ? 8 : 60;
const ANSWER = FAST ? 6 : 60;
const QS = [
  { q: '26 yoshli sog‘lom tibbiyot xodimi aspirantura uchun yozma maqola tayyorlamoqda, u oldindan yig‘ilgan klinik anketalar va laborator natijalarni tahlil qiladi; hozirgi loyihada AB (arterial bosim) 118/76 mm sim ust., tana harorati 36.7°C, leykotsitlar 7.2 x10^9/l, C-reaktiv oqsil 2.1 mg/l, biroq muallif ma’lumotlar to‘plamida 40 nafar ishtirokchidan 12 nafarining natijalari yo‘qolganini aniqladi va ularni qayta tiklash imkoni yo‘q. Tadqiqot etikasi nuqtai nazaridan muallif qanday yo‘l tutishi to‘g‘ri bo‘ladi?', o: ['Yo‘qolgan natijalarni ochiq ko‘rsatib, tahlilni qolgan 28 nafar ishtirokchi bo‘yicha o‘tkazish va cheklovlar bo‘limida bayon qilish', 'Yo‘qolgan 12 nafar ishtirokchi natijalarini o‘rtacha qiymatlar bilan to‘ldirib, buni maqolada eslatmaslik', 'Natijalarni o‘xshash boshqa tadqiqotdan olib, ishtirokchilar soni 40 nafar deb ko‘rsatish', 'C-reaktiv_oqsil_2.1mg/l_leykotsitlar_7.2x10^9/l_harorat_36.7°C_bosim_118/76_mm_sim_ust_uzun_bo‘sh_joysiz_matn'] },
  { q: 'O‘tkir koronar sindrom gumon qilingan bemorda birinchi 10 daqiqada qaysi tekshiruv bajarilishi shart?', o: ['12 ulanishli EKG', 'Exokardiografiya', 'Koronar angiografiya', 'Ko‘krak qafasi rentgenografiyasi'] },
  { q: 'Troponin darajasi miokard shikastlanishidan keyin qachon ko‘tarila boshlaydi?', o: ['3–4 soatdan keyin', '30 daqiqada', '24 soatdan keyin', '7 kundan keyin'] },
  { q: 'ST elevatsiyali miokard infarktida reperfuziyaning afzal usuli qaysi?', o: ['Birlamchi PCI', 'Faqat antikoagulyant', 'Nitratlar', 'Beta-blokatorlar'] },
];
const LAG = new URLSearchParams(window.location.search).get('lag') === '1';
const S = { phase: 'lobby', ready: false, started: 0, answers: [] as number[] };

function stateNow() {
  const now = Date.now();
  if (S.phase !== 'running') return { phase: S.phase, stage: '', index: S.phase === 'done' ? QS.length : 0, readEnds: null, ends: null, now };
  const el = (now - S.started) / 1000;
  const k = Math.floor(el / (READ + ANSWER));
  if (k >= QS.length) {
    S.phase = 'done';
    return { phase: 'done', stage: '', index: QS.length, readEnds: null, ends: null, now };
  }
  const start = S.started + k * (READ + ANSWER) * 1000;
  const readEnds = start + READ * 1000;
  return { phase: 'running', stage: now < readEnds ? 'read' : 'answer', index: k, readEnds, ends: readEnds + ANSWER * 1000, now };
}

function common(st: ReturnType<typeof stateNow>) {
  return { phase: st.phase, stage: st.stage, index: st.index, total: QS.length, read_seconds: READ, answer_seconds: ANSWER,
    read_ends_at_ms: st.readEnds, ends_at_ms: st.ends, server_now_ms: st.now };
}

function student() {
  const st = stateNow();
  // Server kabi: o'qishning oxirgi 6 s ida variantlar `next_options` da oldindan.
  const ahead = st.phase === 'running' && st.stage === 'read' && st.readEnds !== null && st.readEnds - st.now <= 6000;
  return { ...common(st), options: st.phase === 'running' && st.stage === 'answer' ? QS[st.index].o : [],
    ...(ahead ? { next_options: QS[st.index].o } : {}), joined: true, ready: S.ready,
    my_answer: S.answers[st.index] ?? -1, submitted: false };
}

function host() {
  const st = stateNow();
  return { ...common(st), question: st.phase === 'running' ? QS[st.index].q : '', options: [],
    joined: 12, ready: S.ready ? 12 : 11, answered_current: S.answers[st.index] != null ? 9 : 4, can_start: S.phase === 'lobby' && S.ready,
    people: Array.from({ length: 12 }, (_, i) => ({ name: `Talaba ${i + 1}`, ready: S.ready || i > 0, answered_current: false })),
    submitted: 0, is_closed: S.phase === 'done' };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function install() {
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url || input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.includes('/monitor/state/') && LAG) {
      // ?lag=1 — sekin mobil internet: o'qish tugaganidan keyingi 9 s ichidagi so'rovlar javob bermaydi.
      const st = stateNow();
      if (st.stage === 'answer' && st.readEnds !== null && st.now - st.readEnds < 9000) await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    if (url.includes('/monitor/join/') || url.includes('/monitor/state/')) return json(student());
    if (url.includes('/monitor/ready/')) { S.ready = true; return json(student()); }
    if (url.includes('/monitor/answer/')) {
      const st = stateNow();
      if (st.stage !== 'answer' || body.index !== st.index) return json({ detail: 'vaqt' }, 409);
      S.answers[st.index] = body.option;
      return json(student());
    }
    if (url.includes('/monitor/host/')) return json(host());
    if (url.includes('/monitor/control/')) {
      if (!S.ready) return json({ detail: 'Hamma tayyor emas: 11/12.' }, 409);
      S.phase = 'running';
      S.started = Date.now();
      return json(host());
    }
    return json({});
  }) as typeof fetch;
}

function Preview() {
  const [analyzed, setAnalyzed] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <AppLanguageContext.Provider value={{ language: 'uz', setLanguage: () => {} }}>
      <div className="grid min-h-screen grid-cols-[1fr_390px] gap-6 bg-slate-100 p-6">
        <div className="rounded-2xl bg-white p-6 shadow">
          <LiveMonitorHost
            sessionKey="lts_preview"
            qr={<div className="flex h-56 w-56 items-center justify-center rounded-2xl bg-slate-900 text-white">QR</div>}
            fallback={<div>eski</div>}
            finalizing={false}
            onAnalyze={() => setAnalyzed(true)}
          />
          {analyzed && <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-800" data-testid="preview-analyzed">Natijalar ochildi (onAnalyze chaqirildi)</p>}
        </div>
        <div className="mx-auto w-[375px] rounded-[2.5rem] border-[10px] border-slate-900 bg-[#f2f2f7] p-3 shadow-xl">
          <div className="h-[740px] overflow-y-auto">
            <StudentMonitorRunner sessionKey="lts_preview" participantKey="p1" firstName="Ali" lastName="Valiyev" lang="uz"
              topic="O‘tkir koronar sindrom" onDone={() => setDone(true)} />
            {done && <p className="mt-3 text-center text-[12px] text-slate-500" data-testid="preview-student-done">onDone chaqirildi</p>}
          </div>
        </div>
      </div>
    </AppLanguageContext.Provider>
  );
}

export function renderMonitorPreview(): boolean {
  if (params.get('monitor') !== '1') return false;
  install();
  createRoot(document.getElementById('root')!).render(<Preview />);
  return true;
}
