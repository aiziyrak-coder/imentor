import { useEffect, useState } from 'react';

/**
 * Monitor rejimi taymerlari (2026-11-12): sekin qisqaruvchi uzun chiziq va orqaga sanovchi raqam.
 *
 * Chiziq SOATGA bog'langan: har 100 ms da qolgan vaqt soatdan qayta hisoblanadi va chiziq unga qisqa o'tish
 * (transition) bilan silliq qisqaradi. CSS animatsiya vaqt chizig'iga tayanilmaydi — brauzer kadr chizishni
 * to'xtatsa ham (fon oynasi, sekin kompyuter) chiziq har doim raqam bilan mos va o'zini o'zi to'g'rilaydi.
 * Rang qolgan ulushga qarab: yashil → sariq → qizil (belgilashda ko'k → sariq → qizil).
 */
export const MONITOR_CSS = `
/* MUHIM: kirish animatsiyalari SHAFFOFLIKNI o'zgartirmaydi — brauzer animatsiyani to'xtatsa (fon oynasi, kuchsiz
   kompyuter) ham savol va variantlar doim to'liq ko'rinadi; faqat harakat/o'lcham animatsiya qilinadi. */
@keyframes imMonIn { from { transform: translateY(22px) scale(.985); } to { transform: none; } }
@keyframes imMonPop { 0% { transform: scale(1.3); } 60% { transform: scale(.97); } 100% { transform: scale(1); } }
@keyframes imMonPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
@keyframes imMonGlow { 0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,.0); } 50% { box-shadow: 0 0 0 12px rgba(239,68,68,.18); } }
.im-mon-in { animation: imMonIn .55s cubic-bezier(.2,.8,.2,1) both; }
.im-mon-pop { animation: imMonPop .45s ease-out both; }
.im-mon-pulse { animation: imMonPulse 1s ease-in-out infinite; }
.im-mon-glow { animation: imMonGlow 1s ease-in-out infinite; }
`;

export function MonitorStyles() {
  return <style>{MONITOR_CSS}</style>;
}

/** Server vaqti bilan moslangan "hozir" — har 200 ms yangilanadi. */
export function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offsetMs), 200);
    setNow(Date.now() + offsetMs);
    return () => window.clearInterval(id);
  }, [offsetMs]);
  return now;
}

export function secondsLeft(endMs: number | null, now: number): number {
  return endMs ? Math.max(0, Math.ceil((endMs - now) / 1000)) : 0;
}

type BarProps = {
  /** Bosqich boshlangan va tugaydigan payt (server vaqti, ms). */
  startMs: number;
  endMs: number;
  /** Server soati bilan farq (ms) — boshlang'ich nuqta to'g'ridan-to'g'ri soatdan olinadi (eskirgan "now" emas). */
  offsetMs: number;
  /** "long" — 40 s o'qish (yashil→qizil), "short" — 10 s belgilash (ko'k→qizil). */
  tone?: 'long' | 'short';
  height?: number | string;
  testId?: string;
};

function toneOf(fraction: number, tone: 'long' | 'short'): string {
  if (tone === 'short') return fraction > 0.5 ? '#3b82f6' : fraction > 0.25 ? '#f59e0b' : '#dc2626';
  return fraction > 0.3 ? '#10b981' : fraction > 0.125 ? '#f59e0b' : '#dc2626';
}

export function CountdownBar({ startMs, endMs, offsetMs, tone = 'long', height = 14, testId }: BarProps) {
  const total = Math.max(100, endMs - startMs);
  const calc = () => Math.min(1, Math.max(0, (endMs - (Date.now() + offsetMs)) / total));
  const [fraction, setFraction] = useState(calc);
  useEffect(() => {
    setFraction(calc());
    const id = window.setInterval(() => setFraction(calc()), 50);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMs, endMs, offsetMs]);
  return (
    <div className="w-full overflow-hidden rounded-full bg-slate-200/80" style={{ height }} data-testid={testId}>
      <div
        className="h-full w-full origin-left rounded-full"
        data-fraction={fraction.toFixed(3)}
        style={{
          transform: `scaleX(${fraction})`,
          backgroundColor: toneOf(fraction, tone),
          transition: 'background-color 600ms ease',
        }}
      />
    </div>
  );
}
