import { useEffect, useRef, useState } from 'react';
import { postActivityEvents, type TelemetryStatus } from '../utils/analyticsApi';

/**
 * Foydalanuvchi qaysi bo'limda qancha vaqt turganini o'lchaydi.
 *
 * ── Nega qayta yozildi ─────────────────────────────────────────────────
 * Ilgari har 60 soniyada "60 soniya ishladi" deb yuborilardi. Bu uch joyda
 * noto'g'ri edi:
 *
 *   1. Varaq yashirin bo'lsa ham sanardi. O'qituvchi iMentorni ochiq
 *      qoldirib ketsa, kechqurun hisobotda sakkiz soat "ishlagan" bo'lib
 *      chiqardi.
 *   2. Bo'lim almashganda oxirgi zarbadan keyingi vaqt YO'QOLARDI.
 *      "Ma'ruza matni"da 55 soniya turib chiqqan odam nolga tushardi.
 *   3. Har doim yaxlit 60 yozilardi — 8 soniya ham, 59 soniya ham.
 *
 * Endi haqiqiy ko'rinib turgan vaqt yig'iladi va quyidagi paytlarda
 * yuboriladi: har daqiqada, bo'lim almashganda, varaq yashirilganda va
 * sahifa yopilganda. Yopilishda so'rov `keepalive` bilan ketadi — oddiy
 * so'rov sahifa yopilib ketayotganda bekor qilinadi.
 *
 * Bo'sh turish: 5 daqiqa (dars ko'rsatiladigan bo'limlarda 20) sichqoncha ham, tugma ham tegilmasa
 * sanoq to'xtaydi. Hisobot "ochiq turgan" emas, "ishlangan" vaqtni
 * ko'rsatishi kerak.
 */

/** Serverga qanchalik tez-tez yuboriladi.
 *
 *  Aniqlik bu qiymatga bog'liq EMAS — vaqt haqiqiy o'lchanadi va bo'lim
 *  almashganda, varaq yashirilganda va yopilganda baribir yuboriladi.
 *  Shuning uchun 60 soniya: 300 o'qituvchi ishlaganda kuniga ~300 ming
 *  emas, ~150 ming qator yoziladi. */
const FLUSH_MS = 60_000;
/** Shuncha vaqt hech narsa qilinmasa — sanoq to'xtaydi. */
const IDLE_MS = 5 * 60_000;
/**
 * Dars ko'rsatiladigan bo'limlarda (2026-10-21): o'qituvchi doskada keys,
 * taqdimot yoki test natijasini ko'rsatib, 10–20 daqiqa gapiradi — sichqonchaga
 * tegmaydi. 5 daqiqalik chegara bu vaqtni "ishlamagan" deb tashlardi va dars
 * "o'tilmagan" chiqardi (masalan test o'tgan parada ham 13–22 daqiqa qolgan).
 */
const TEACHING_IDLE_MS = 20 * 60_000;
export const TEACHING_PAGES = new Set([
  'presentation', 'lectures', 'cases', 'tests', 'my-tests', 'videos', 'handouts', 'syllabus', 'content-catalog',
]);

export function idleLimitFor(page: string): number {
  return TEACHING_PAGES.has(page) ? TEACHING_IDLE_MS : IDLE_MS;
}
/**
 * «Sahifa ekranda ochiq» belgisi (2026-11-19): harakatsizlik chegarasidan keyin heartbeat to'xtaydi, shuning uchun
 * tarqatmani 50 daqiqa ko'rsatib turgan o'qituvchi dars botida «chiqib ketdi» bo'lib chiqardi. Varaq ko'rinib
 * turgan va brauzer fokusda bo'lsa, shuncha vaqtda bir `presence` yuboriladi. Server uni vaqt hisobiga QO'SHMAYDI —
 * faqat botning «chiqib ketdi» tekshiruvi uchun (`page_presence`).
 */
const PRESENCE_MS = 5 * 60_000;
/** Sahifa yuklanganda bir marta: «bu brauzer belgi yuboradi» — bot faqat shundaylarga «chiqib ketdi» yozadi. */
let presenceHelloSent = false;

/** Bundan qisqa bo'lak yuborilmaydi (tarmoqni bo'shga band qilmaslik uchun). */
const MIN_FLUSH_SEC = 5;

/** Shuncha ketma-ket xatodan keyin ogohlantirish chiqadi. Bitta uzilish
 *  (masalan server qayta ishga tushayotgan daqiqa) foydalanuvchini
 *  bezovta qilmasin: vaqt navbatda saqlanadi va keyin yuboriladi. */
const FAILURES_BEFORE_WARNING = 3;

/** `null` — hammasi joyida; `'network'` — ulanish yo'q; `'auth'` — qayta kirish kerak. */
export type TelemetryProblem = null | 'network' | 'auth';

export function useActivityTelemetry(enabled: boolean, page: string, withPresence = false): TelemetryProblem {
  const [problem, setProblem] = useState<TelemetryProblem>(null);
  useEffect(() => {
    setProblem(null);
    if (!enabled) return;
    let failures = 0;
    const status = (event: Event) => {
      const detail = (event as CustomEvent<TelemetryStatus>).detail;
      if (detail?.ok) {
        failures = 0;
        setProblem(null);
        return;
      }
      failures += 1;
      // Kirish muddati tugagani o'z-o'zidan tuzalmaydi — darhol aytamiz.
      if (detail?.reason === 'auth') setProblem('auth');
      else if (failures >= FAILURES_BEFORE_WARNING) setProblem('network');
    };
    window.addEventListener('imentor:telemetry-status', status);
    return () => window.removeEventListener('imentor:telemetry-status', status);
  }, [enabled]);
  const pageRef = useRef(page);
  // Joriy bo'limda yig'ilgan, hali yuborilmagan soniyalar.
  const pendingRef = useRef(0);
  // Sanoq boshlangan payt (null — sanoq to'xtagan).
  const tickingSinceRef = useRef<number | null>(null);
  const lastInputRef = useRef(Date.now());
  const lastPresenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const now = () => Date.now();
    const idleMs = idleLimitFor(page);

    /** Sanoqni to'xtatib, o'tgan vaqtni `pending` ga qo'shadi. */
    const collect = () => {
      const since = tickingSinceRef.current;
      if (since === null) return;
      const until = Math.min(now(), lastInputRef.current + idleMs);
      pendingRef.current += Math.max(0, Math.round((until - since) / 1000));
      tickingSinceRef.current = null;
    };

    const resume = () => {
      if (tickingSinceRef.current === null && !document.hidden) {
        tickingSinceRef.current = now();
      }
    };

    /** Yig'ilganini serverga uzatadi. `beacon` — sahifa yopilayotganda. */
    const flush = (forPage: string, beacon = false, leaving = false) => {
      collect();
      const sec = pendingRef.current;
      if (sec < (leaving ? 1 : MIN_FLUSH_SEC)) {
        if (leaving) pendingRef.current = 0;
        if (!beacon) resume();
        return;
      }
      pendingRef.current = 0;
      void postActivityEvents([{ event_type: 'heartbeat', duration_sec: sec }], forPage, {
        beacon,
      });
      if (!beacon) resume();
    };

    const onInput = () => {
      lastInputRef.current = now();
      resume();
    };

    const onVisibility = () => {
      if (document.hidden) flush(pageRef.current);
      else {
        lastInputRef.current = now();
        resume();
      }
    };

    const onUnload = () => flush(pageRef.current, true, true);

    if (withPresence && !presenceHelloSent) {
      presenceHelloSent = true;
      void postActivityEvents([{ event_type: 'presence', duration_sec: 0 }], page);
    }

    // Bo'limga kirilgani — vaqtdan qat'i nazar yoziladi, chunki hisobotda
    // "ochdimi" degan savol "qancha turdi" dan alohida.
    void postActivityEvents([{ event_type: 'page_view', duration_sec: 0 }], page);

    lastInputRef.current = now();
    resume();

    const timer = window.setInterval(() => {
      // Bo'sh turish: oxirgi harakatdan beri IDLE_MS o'tgan bo'lsa sanamaymiz.
      if (now() - lastInputRef.current > idleMs) {
        flush(pageRef.current);
        tickingSinceRef.current = null;
        // 2026-11-20: «ochiq» = sahifa ko'rinib turibdi (proyektorda ochiq, fokus boshqa oynada bo'lsa ham).
        if (withPresence && !document.hidden && now() - lastPresenceRef.current >= PRESENCE_MS) {
          lastPresenceRef.current = now();
          void postActivityEvents([{ event_type: 'presence', duration_sec: 0 }], pageRef.current);
        }
        return;
      }
      flush(pageRef.current);
    }, FLUSH_MS);

    const INPUTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const ev of INPUTS) window.addEventListener(ev, onInput, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onUnload);

    const leavingPage = page;
    return () => {
      window.clearInterval(timer);
      for (const ev of INPUTS) window.removeEventListener(ev, onInput);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onUnload);
      // Bo'lim almashyapti: qolgan vaqt ESKI bo'lim hisobiga yozilsin.
      flush(leavingPage, false, true);
      tickingSinceRef.current = null;
    };
  }, [enabled, page, withPresence]);

  pageRef.current = page;
  return problem;
}
