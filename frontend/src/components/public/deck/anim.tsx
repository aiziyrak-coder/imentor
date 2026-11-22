/**
 * Taqdimot animatsiyalari uchun umumiy bo'laklar (2026-11-13).
 *
 * `StaticCtx` — `?static=1` (skrinshot, chop etish) yoki tizimda "harakatni kamaytirish" yoqilgan bo'lsa:
 * hamma narsa darhol yakuniy holatda chiziladi, aylanuvchi hikoyalar eng tushunarli bosqichda to'xtaydi.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { animate, motion, type Transition } from 'motion/react';

export const StaticCtx = createContext(false);
export const useStatic = () => useContext(StaticCtx);

export const SPRING: Transition = { type: 'spring', stiffness: 240, damping: 24, mass: 0.9 };
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type RevealProps = {
  delay?: number;
  y?: number;
  x?: number;
  scale?: number;
  blur?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/** Pastdan/yondan yumshoq paydo bo'lish. */
export function Reveal({ delay = 0, y = 18, x = 0, scale = 1, blur = false, className, style, children }: RevealProps) {
  const still = useStatic();
  return (
    <motion.div
      className={className}
      style={style}
      initial={still ? false : { opacity: 0, y, x, scale, filter: blur ? 'blur(8px)' : 'blur(0px)' }}
      animate={{ opacity: 1, y: 0, x: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{ ...SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Raqam noldan maqsadgacha sanab chiqadi. */
export function useCountUp(target: number, { duration = 1.6, delay = 0 } = {}): number {
  const still = useStatic();
  const [value, setValue] = useState(still ? target : 0);
  useEffect(() => {
    if (still) { setValue(target); return undefined; }
    const controls = animate(0, target, { duration, delay, ease: EASE_OUT, onUpdate: (v) => setValue(v) });
    return () => controls.stop();
  }, [target, duration, delay, still]);
  return value;
}

/** Raqam oldingi qiymatidan yangisiga silliq o'tadi (birinchi marta — noldan). */
export function useTween(target: number, { duration = 1.2, delay = 0 } = {}): number {
  const still = useStatic();
  const [value, setValue] = useState(still ? target : 0);
  const prev = React.useRef(still ? target : 0);
  useEffect(() => {
    if (still) { setValue(target); prev.current = target; return undefined; }
    const controls = animate(prev.current, target, {
      duration, delay, ease: EASE_OUT,
      onUpdate: (v) => { prev.current = v; setValue(v); },
    });
    return () => controls.stop();
  }, [target, duration, delay, still]);
  return value;
}

/**
 * Aylanuvchi hikoya: `steps` — har bosqich davomiyligi (ms). Qaytaradi: joriy bosqich raqami.
 * Statik rejimda — `still` bosqichi (eng ko'p narsa ko'rinadigan).
 */
export function useStory(steps: number[], still: number, { loop = true, startDelay = 0 } = {}): number {
  const isStatic = useStatic();
  const [step, setStep] = useState(isStatic ? still : 0);
  useEffect(() => {
    if (isStatic) { setStep(still); return undefined; }
    let alive = true;
    let timer = 0;
    let i = 0;
    const next = () => {
      if (!alive) return;
      const wait = steps[i] ?? 1000;
      timer = window.setTimeout(() => {
        if (!alive) return;
        if (i + 1 >= steps.length) {
          if (!loop) return;
          i = 0;
        } else {
          i += 1;
        }
        setStep(i);
        next();
      }, wait);
    };
    timer = window.setTimeout(() => { setStep(0); next(); }, startDelay);
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatic, still, loop, startDelay, steps.join(',')]);
  return step;
}

/** Matn harfma-harf yoziladi (`run` — boshlash). */
export function useTypewriter(text: string, run: boolean, cps = 28): string {
  const isStatic = useStatic();
  const [n, setN] = useState(isStatic ? text.length : 0);
  useEffect(() => {
    if (isStatic) { setN(text.length); return undefined; }
    if (!run) { setN(0); return undefined; }
    setN(0);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 1000 / cps);
    return () => window.clearInterval(id);
  }, [text, run, cps, isStatic]);
  return text.slice(0, n);
}

/** Sarlavha: so'zlar ketma-ket ko'tariladi; `[[...]]` qismi gradient bilan. */
export function WordsTitle({ text, level, delay = 0.05 }: { text: string; level: 1 | 2; delay?: number }) {
  const still = useStatic();
  const Tag = level === 1 ? motion.h1 : motion.h2;
  const parts = text.split(/(\[\[.*?\]\])/g).filter(Boolean);
  const words: { w: string; accent: boolean }[] = [];
  for (const p of parts) {
    const accent = p.startsWith('[[');
    const body = accent ? p.slice(2, -2) : p;
    for (const w of body.split(/(\s+)/)) if (w) words.push({ w, accent });
  }
  let k = 0;
  return (
    <Tag className="deck-title" aria-label={text.replace(/\[\[|\]\]/g, '')}>
      {words.map((item, i) => {
        if (/^\s+$/.test(item.w)) return <React.Fragment key={i}>{' '}</React.Fragment>;
        const d = delay + k * 0.055;
        k += 1;
        return (
          <motion.span
            key={i}
            aria-hidden
            className={`deck-word ${item.accent ? 'deck-accent' : ''}`}
            initial={still ? false : { opacity: 0, y: '0.55em', filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ ...SPRING, delay: d }}
          >
            {item.w}
          </motion.span>
        );
      })}
    </Tag>
  );
}
