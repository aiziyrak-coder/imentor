/**
 * Taqdimot slaydlaridagi JONLI interfeys bo'laklari (2026-11-13). Har biri qisqa hikoya: nima bo'layotgani
 * ko'z oldida sodir bo'ladi (material yaratiladi, taymer sanaydi, telefonda variantlar ochiladi, grafik o'sadi).
 * Ism va raqamlar — namunaviy; haqiqiy jami raqamlar `PITCH_STATS` dan.
 */
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import QRCode from 'qrcode';
import {
  ArrowRight, BookOpen, Check, ClipboardCheck, Database, FileText, Globe2, Hand, Library, LineChart, Lock, MonitorPlay,
  Presentation, QrCode, ScanFace, Send, Server, ShieldCheck, Sparkles, Stethoscope, Users, Wallet, X,
} from 'lucide-react';
import { PITCH_STATS } from '../pitchContent';
import { Reveal, SPRING, useCountUp, useStatic, useStory, useTween, useTypewriter } from './anim';

type UI = Record<string, string>;
type Icon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n)).replace(/,/g, ' ');

function Card({ children, className = '', glow = false }: { children: React.ReactNode; className?: string; glow?: boolean }) {
  return <div className={`deck-card ${glow ? 'deck-card-glow' : ''} ${className}`}>{children}</div>;
}

function Pop({ show, children, className = '', delay = 0 }: { show: boolean; children: React.ReactNode; className?: string; delay?: number }) {
  const still = useStatic();
  return (
    <AnimatePresence initial={!still}>
      {show && (
        <motion.span
          className={className}
          initial={still ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ ...SPRING, delay }}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Fill({ on, color = 'green', duration = 0.7 }: { on: boolean; color?: 'green' | 'blue'; duration?: number }) {
  const still = useStatic();
  return (
    <span className="deck-track">
      <motion.span
        className={`deck-fill deck-fill-${color}`}
        initial={false}
        animate={{ width: on ? '100%' : '0%' }}
        transition={still ? { duration: 0 } : { duration, ease: [0.4, 0, 0.2, 1] }}
      />
    </span>
  );
}

export function Caption({ text }: { text?: string }) {
  if (!text) return null;
  return <Reveal delay={0.9} y={6} className="deck-caption"><span className="deck-caption-dot" />{text}</Reveal>;
}

// ------------------------------------------------------------------ 1. Titul — material ko'z oldida yaratiladi

export function TitleVisual({ ui }: { ui: UI }) {
  const step = useStory([1300, 650, 650, 650, 650, 4200], 5, { startDelay: 500 });
  const topic = useTypewriter(ui.topic, step >= 0, 26);
  const rows: [Icon, string][] = [[FileText, ui.lecture], [Presentation, ui.slides], [Stethoscope, ui.case], [QrCode, ui.test]];
  return (
    <div className="deck-visual">
      <Reveal delay={0.35} scale={0.94}>
        <Card glow>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 font-semibold text-slate-800">
              <Sparkles className="deck-ic text-violet-500" />
              <span className="truncate">{topic}<span className="deck-caret" /></span>
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {step >= 5
                ? <motion.span key="r" className="deck-chip deck-chip-green" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}>{ui.ready}</motion.span>
                : <motion.span key="m" className="deck-chip deck-chip-blue" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="deck-spin" />{ui.make}</motion.span>}
            </AnimatePresence>
          </div>
          <div className="mt-[1em] space-y-[0.55em]">
            {rows.map(([I, label], i) => {
              const done = step >= i + 1;
              return (
                <div key={label} className={`deck-row ${done ? 'deck-row-done' : ''}`}>
                  <span className="deck-row-ic"><I className="deck-ic" /></span>
                  <span className="flex-1 text-slate-700">{label}</span>
                  <Fill on={done} />
                  <span className="deck-check-slot"><Pop show={done}><Check className="deck-ic text-emerald-600" strokeWidth={3} /></Pop></span>
                </div>
              );
            })}
          </div>
          <p className="mt-[1em] flex items-center gap-2 text-[0.82em] text-slate-500"><BookOpen className="deck-ic" />{ui.source}</p>
        </Card>
      </Reveal>
      <Pop show={step >= 5} className="deck-pin deck-pin-tl deck-bob"><Users className="deck-ic text-blue-600" /><span><LiveCount text={ui.live} /></span></Pop>
      <Pop show={step >= 5} delay={0.25} className="deck-pin deck-pin-br deck-bob-2"><ShieldCheck className="deck-ic text-emerald-600" /><span>{ui.rector}</span></Pop>
    </div>
  );
}

/** "Darsda: 28 / 30 …" — 28 soni noldan sanab chiqadi (har tilda matn ichida "28" bor). */
function LiveCount({ text }: { text: string }) {
  const v = useCountUp(28, { duration: 1.2, delay: 0.2 });
  const at = text.indexOf('28');
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<b className="tabular-nums">{Math.round(v)}</b>{text.slice(at + 2)}</>;
}

// ------------------------------------------------------------------ 5. O'qituvchi — mavzu yoziladi, tugma, 4 material

function Clock({ seconds }: { seconds: number }) {
  const v = useCountUp(seconds, { duration: 2.4 });
  const s = Math.round(v);
  return <span className="deck-mono">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

export function TeacherVisual({ ui }: { ui: UI }) {
  const step = useStory([2100, 700, 2600, 4200], 3, { startDelay: 450 });
  const typed = useTypewriter(ui.topic, step >= 0, 30);
  const items: [Icon, string, string][] = [
    [FileText, ui.lecture, ui.lectureMeta], [Presentation, ui.slides, ui.slidesMeta],
    [Stethoscope, ui.case, ui.caseMeta], [QrCode, ui.test, ui.testMeta],
  ];
  return (
    <div className="deck-visual">
      <Reveal delay={0.3} scale={0.95}>
        <Card glow>
          <p className="deck-label">{ui.head}</p>
          <div className="mt-[0.6em] flex items-center gap-[0.6em]">
            <div className="deck-input"><span className="shrink-0 text-slate-400">{ui.field}:</span><span className="min-w-0 truncate text-slate-900">{typed}</span>{step === 0 && <span className="deck-caret" />}</div>
            <motion.span className="deck-btn-demo" animate={step === 1 ? { scale: [1, 0.9, 1] } : { scale: 1 }} transition={{ duration: 0.45 }}>
              <Sparkles className="deck-ic" />{ui.generate}
              {step === 1 && <span className="deck-ripple" />}
            </motion.span>
          </div>
          <div className="mt-[1em] grid grid-cols-2 gap-[0.7em]">
            {items.map(([I, t, m], i) => {
              const on = step >= 2;
              return (
                <motion.div key={t} className="deck-tile" initial={false}
                  animate={on ? { opacity: 1, y: 0 } : { opacity: 0.35, y: 0 }}
                  transition={{ ...SPRING, delay: on ? i * 0.45 : 0 }}>
                  <div className="flex items-center justify-between">
                    <I className="deck-ic-lg text-blue-600" />
                    <Pop show={step >= 3} delay={i * 0.08}><Check className="deck-ic text-emerald-600" strokeWidth={3} /></Pop>
                  </div>
                  <p className="mt-[0.45em] font-semibold text-slate-800">{t}</p>
                  <p className="text-[0.8em] text-slate-500">{m}</p>
                  <div className="mt-[0.5em]"><Fill on={on} color="blue" duration={0.45 + i * 0.45} /></div>
                </motion.div>
              );
            })}
          </div>
          <div className="mt-[0.9em] flex items-center justify-between text-[0.85em]">
            <AnimatePresence mode="wait" initial={false}>
              {step >= 3
                ? <motion.span key="d" className="deck-chip deck-chip-green" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}><Check className="deck-ic" strokeWidth={3} />{ui.done} · 4 / 4</motion.span>
                : <motion.span key="w" className="text-slate-400" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>…</motion.span>}
            </AnimatePresence>
            <span className="text-slate-500">{step >= 2 ? <Clock seconds={220} /> : <span className="deck-mono">0:00</span>}</span>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

// ------------------------------------------------------------------ 6. Sifat — matn manbaga bog'lanadi

export function QualityVisual({ ui }: { ui: UI }) {
  const step = useStory([900, 1100, 1100, 4500], 3, { startDelay: 400 });
  return (
    <div className="deck-visual space-y-[0.9em]">
      <Reveal delay={0.3}>
        <Card glow>
          <p className="deck-label">{ui.head}</p>
          <p className="mt-[0.7em] leading-[1.7] text-slate-700">
            <span className={`deck-hl ${step >= 1 ? 'deck-hl-on' : ''}`}>{ui.p1}</span>{' '}
            <Pop show={step >= 1} className="deck-cite">{ui.c1}</Pop>{' '}
            <span className={`deck-hl deck-hl-green ${step >= 2 ? 'deck-hl-on' : ''}`}>{ui.p2}</span>{' '}
            <Pop show={step >= 2} className="deck-cite deck-cite-green">{ui.c2}</Pop>
          </p>
          <div className="mt-[1em] flex flex-wrap gap-[0.5em]">
            {[ui.ok1, ui.ok2, ui.ok3].map((t, i) => (
              <Pop key={t} show={step >= 3} delay={i * 0.12} className="deck-chip deck-chip-green"><Check className="deck-ic" strokeWidth={3} />{t}</Pop>
            ))}
          </div>
        </Card>
      </Reveal>
      <div className="grid grid-cols-2 gap-[0.8em]">
        <Reveal delay={0.5}>
          <Card className={`deck-source ${step >= 1 ? 'deck-source-on' : ''}`}>
            <Library className="deck-ic-lg text-blue-600" />
            <div><p className="font-semibold text-slate-800">{ui.book}</p><p className="text-[0.8em] text-slate-500">{fmt(PITCH_STATS.books)} {ui.books}</p></div>
          </Card>
        </Reveal>
        <Reveal delay={0.62}>
          <Card className={`deck-source deck-source-green ${step >= 2 ? 'deck-source-on' : ''}`}>
            <ClipboardCheck className="deck-ic-lg text-emerald-600" />
            <div><p className="font-semibold text-slate-800">{ui.protocol}</p><p className="text-[0.8em] text-slate-500">{fmt(PITCH_STATS.protocols)} {ui.protocols}</p></div>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 7. Jonli test — o'qish, keyin belgilash (tezlashtirilgan)

/** Tekis teskari sanoq (namoyish tezligida: `from` soniya `seconds` ichida). */
function CountDown({ from, seconds }: { from: number; seconds: number }) {
  const [left, setLeft] = useState(from);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / (seconds * 1000));
      setLeft(Math.max(0, Math.ceil(from * (1 - k))));
    }, 80);
    return () => window.clearInterval(id);
  }, [from, seconds]);
  return <>{left}</>;
}

/** "Javob berdi: N / 30" — belgilash paytida talabalar javobi sanab boradi. */
function Answered({ label, marking }: { label: string; marking: boolean }) {
  const head = label.split(':')[0];
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!marking) { setN(0); return undefined; }
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / 3600);
      setN(Math.round(29 * (1 - Math.pow(1 - k, 2))));
    }, 90);
    return () => window.clearInterval(id);
  }, [marking]);
  return <span className={`whitespace-nowrap tabular-nums ${marking ? 'font-bold text-slate-800' : ''}`}>{head}: {n} / 30</span>;
}

function PhoneMarking() {
  const step = useStory([1500, 99999], 1, { loop: false });
  return (
    <div className="space-y-[0.4em]">
      {['A', 'B', 'C', 'D', 'E'].map((l, i) => (
        <motion.div key={l} className={`deck-opt ${step >= 1 && i === 1 ? 'deck-opt-on' : ''}`}
          initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ ...SPRING, delay: i * 0.07 }}>
          <span>{l}</span><span className="deck-skel flex-1" />
          {step >= 1 && i === 1 && <Hand className="deck-tap" />}
        </motion.div>
      ))}
    </div>
  );
}

export function LiveVisual({ ui }: { ui: UI }) {
  const phase = useStory([4600, 4600], 1, { startDelay: 300 });
  const marking = phase === 1;
  const still = useStatic();
  return (
    <div className="deck-visual">
      <div className="flex items-end gap-[1em]">
        <Reveal delay={0.3} className="min-w-0 flex-1">
          <Card glow>
            <div className="flex items-center justify-between text-[0.8em]">
              <span className="deck-chip deck-chip-dark">{ui.q}</span>
              <span className="flex items-center gap-1 whitespace-nowrap text-slate-500"><Users className="deck-ic" />
                {still ? ui.answered : <Answered label={ui.answered} marking={marking} />}
              </span>
            </div>
            <p className="mt-[0.8em] text-[1.12em] font-bold leading-snug text-slate-900">{ui.question}</p>
            <div className="mt-[0.9em] flex items-center justify-between">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={marking ? 'm' : 'r'} className={`deck-chip ${marking ? 'deck-chip-red deck-pulse' : 'deck-chip-blue'}`}
                  initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}>
                  {marking ? ui.mark : <><MonitorPlay className="deck-ic" />{ui.readLabel} · 60 s</>}
                </motion.span>
              </AnimatePresence>
              <span key={phase} className={`deck-mono text-[2.3em] font-extrabold leading-none ${marking ? 'text-rose-600' : 'text-slate-900'}`}>
                {still ? 42 : <CountDown from={60} seconds={4.4} />}
              </span>
            </div>
            <div className="deck-track mt-[0.5em] h-[0.5em]">
              <span key={phase} className={`deck-fill ${marking ? 'deck-fill-red' : 'deck-fill-blue'} ${still ? '' : 'deck-drain'}`}
                style={{ width: still ? '70%' : undefined, animationDuration: '4.4s' }} />
            </div>
            <p className="mt-[0.5em] text-right text-[0.7em] text-slate-400">{ui.demo}</p>
          </Card>
        </Reveal>
        <Reveal delay={0.45} y={30} className="deck-phone">
          <div className="deck-phone-screen">
            <AnimatePresence mode="wait" initial={false}>
              {marking ? (
                <motion.div key="m" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <p className="deck-phone-mark">{ui.mark}</p>
                  <div className="mt-[0.5em]"><PhoneMarking /></div>
                </motion.div>
              ) : (
                <motion.div key="r" className="flex h-full flex-col items-center justify-center gap-[0.5em] text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <MonitorPlay className="deck-ic-lg text-blue-600" />
                  <p className="text-[0.72em] font-bold text-slate-800">{ui.phone}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 8. Talaba — yuz bilan kirish, ota-onaga xabar

export function StudentVisual({ ui }: { ui: UI }) {
  const step = useStory([1900, 1000, 1500, 4500], 3, { startDelay: 400 });
  const score = useCountUp(step >= 3 ? 8 : 0, { duration: 0.9 });
  return (
    <div className="deck-visual grid grid-cols-[0.8fr_1.2fr] items-center gap-[1em]">
      <Reveal delay={0.3}>
        <Card className="flex flex-col items-center text-center">
          <div className={`deck-face ${step >= 1 ? 'deck-face-ok' : ''}`}>
            <ScanFace className="h-[3.2em] w-[3.2em]" strokeWidth={1.4} />
            {step === 0 && <span className="deck-scanline" />}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={step >= 1 ? 'ok' : 'scan'} className={`mt-[0.7em] text-[0.82em] font-semibold ${step >= 1 ? 'text-emerald-600' : 'text-slate-500'}`}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              {step >= 1 ? <><Check className="deck-ic mr-1 inline" strokeWidth={3} />{ui.face}</> : ui.scan}
            </motion.p>
          </AnimatePresence>
        </Card>
      </Reveal>
      <Reveal delay={0.45}>
        <Card glow>
          <div className="flex items-center gap-[0.6em]">
            <span className="flex h-[2.2em] w-[2.2em] items-center justify-center rounded-full bg-sky-500 text-white"><Send className="deck-ic" /></span>
            <div>
              <p className="font-bold text-slate-900">{ui.bot}</p>
              <p className="text-[0.75em] text-slate-500">{step === 2 ? ui.typing : 'Telegram'}</p>
            </div>
          </div>
          <div className="mt-[0.9em] min-h-[6.6em]">
            <AnimatePresence mode="wait" initial={false}>
              {step === 2 && (
                <motion.div key="t" className="deck-bubble deck-typing" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <span /><span /><span />
                </motion.div>
              )}
              {step >= 3 && (
                <motion.div key="m" className="deck-bubble" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING}>
                  <p className="text-slate-800">{ui.msg}</p>
                  <p className="mt-[0.35em] text-[0.82em] text-slate-500">{ui.topic}</p>
                  <p className="mt-[0.35em] text-[2em] font-extrabold leading-none text-emerald-600">{Math.round(score)} / 10</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="mt-[0.6em] text-[0.8em] text-slate-500">{ui.daily}</p>
        </Card>
      </Reveal>
    </div>
  );
}

// ------------------------------------------------------------------ 9. Rektor — ustunlar o'sadi, hisobot yangilanadi

const RECTOR_BARS = [94, 89, 86, 81, 77];

function Pct({ value, delay }: { value: number; delay: number }) {
  const v = useTween(value, { duration: 1.3, delay });
  return <>{Math.round(v)}%</>;
}

export function RectorVisual({ ui }: { ui: UI }) {
  const names = [ui.d1, ui.d2, ui.d3, ui.d4, ui.d5];
  const toast = useStory([2600, 3200], 1, { startDelay: 2200 });
  const still = useStatic();
  // Dars tugadi — bitta kafedra ustuni yangilanadi (namuna); institut jami — haqiqiy raqam, o'zgarmaydi.
  const updated = toast === 1;
  const bars = RECTOR_BARS.map((v, i) => (i === 1 && updated ? 92 : v));
  return (
    <div className="deck-visual">
      <Reveal delay={0.3}>
        <Card glow>
          <div className="flex items-start justify-between">
            <div><p className="deck-label">{ui.head}</p><p className="text-[0.85em] text-slate-500">{ui.sub}</p></div>
            <span className="deck-live"><span />LIVE</span>
          </div>
          <div className="mt-[1em] space-y-[0.65em]">
            {names.map((n, i) => (
              <div key={n} className={`deck-rrow grid grid-cols-[9.5em_1fr_3em] items-center gap-[0.7em] ${i === 1 && updated ? 'deck-rrow-on' : ''}`}>
                <span className="truncate text-slate-700">{n}</span>
                <span className="deck-track deck-track-full h-[0.7em]">
                  <motion.span className={`deck-fill ${i === 1 && updated ? 'deck-fill-green' : 'deck-fill-blue'}`} initial={still ? false : { width: '0%' }} animate={{ width: `${bars[i]}%` }}
                    transition={{ duration: 1.1, delay: updated ? 0 : 0.5 + i * 0.12, ease: [0.16, 1, 0.3, 1] }} />
                </span>
                <span className="deck-mono text-right font-semibold text-slate-800"><Pct value={bars[i]} delay={updated ? 0 : 0.5 + i * 0.12} /></span>
              </div>
            ))}
          </div>
          <div className="mt-[1em] flex items-center justify-between border-t border-slate-100 pt-[0.8em]">
            <span className="flex items-center gap-2 text-slate-600"><LineChart className="deck-ic text-blue-600" />{ui.total}</span>
            <span className="text-[1.7em] font-extrabold text-blue-700"><Pct value={PITCH_STATS.monthPercent} delay={1.1} /></span>
          </div>
        </Card>
      </Reveal>
      <Pop show={toast === 1} className="deck-toast"><span className="deck-live-dot" />{ui.toast}</Pop>
    </div>
  );
}

// ------------------------------------------------------------------ 10. Sabab — har qator o'z izohi bilan

export function ReasonsVisual({ ui }: { ui: UI }) {
  const rows: [string, string, string][] = [[ui.r1, ui.s1, 'green'], [ui.r2, ui.s2, 'amber'], [ui.r3, ui.s3, 'gray'], [ui.r4, ui.s4, 'red']];
  const step = useStory([2400, 4500], 1, { startDelay: 300, loop: false });
  return (
    <div className="deck-visual">
      <Reveal delay={0.25}>
        <Card glow>
          <p className="deck-label">{ui.head}</p>
          <div className="mt-[0.9em] space-y-[0.55em]">
            {rows.map(([r, s, tone], i) => (
              <Reveal key={r} delay={0.45 + i * 0.32} x={-18} y={0}>
                <div className={`deck-reason deck-reason-${tone}`}>
                  <span className={`deck-dot deck-dot-${tone}`} />
                  <span className="deck-mono w-[12em] shrink-0 whitespace-nowrap text-[0.8em] text-slate-500">{r}</span>
                  <span className="text-slate-800">{s}</span>
                </div>
              </Reveal>
            ))}
          </div>
          <AnimatePresence>
            {step >= 1 && (
              <motion.div className="deck-hint" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
                <Sparkles className="deck-ic text-amber-500" />{ui.hint}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </Reveal>
    </div>
  );
}

// ------------------------------------------------------------------ 11. Uch til — bitta sarlavha tillar bo'ylab almashadi

const LANG_SAMPLES: [string, string][] = [
  ['UZ', 'Miokard infarkti: tashxis va davolash'],
  ['RU', 'Инфаркт миокарда: диагностика и лечение'],
  ['EN', 'Myocardial infarction: diagnosis and treatment'],
];

export function LanguagesVisual({ ui }: { ui: UI }) {
  const i = useStory([2300, 2300, 2300], 0, { startDelay: 900 });
  return (
    <div className="deck-visual space-y-[0.9em]">
      <Reveal delay={0.3}>
        <Card glow>
          <div className="flex gap-[0.4em]">
            {LANG_SAMPLES.map(([code], k) => (
              <span key={code} className="deck-lang-tab">
                {k === i && <motion.span layoutId="deck-lang-pill" className="deck-lang-pill" transition={SPRING} />}
                <span className="relative">{code}</span>
              </span>
            ))}
          </div>
          <div className="relative mt-[1em] min-h-[3.6em]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={i} className="text-[1.45em] font-bold leading-snug text-slate-900"
                initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -16, filter: 'blur(6px)' }} transition={{ duration: 0.45 }}>
                {LANG_SAMPLES[i][1]}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className="mt-[0.6em] flex flex-wrap gap-[0.5em]">
            {[FileText, Presentation, Stethoscope, QrCode].map((I, k) => (
              <span key={k} className="deck-chip deck-chip-soft"><I className="deck-ic" /><Check className="deck-ic text-emerald-600" strokeWidth={3} /></span>
            ))}
          </div>
        </Card>
      </Reveal>
      <div className="grid grid-cols-3 gap-[0.7em]">
        {[ui.g1, ui.g2, ui.g3].map((g, k) => (
          <Reveal key={g} delay={0.55 + k * 0.1}>
            <div className={`deck-group ${k === i ? 'deck-group-on' : ''}`}>
              <Users className="deck-ic" /><span>{g}</span>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.8} className="flex items-center gap-2 pl-[0.3em] text-[0.88em] text-slate-500">
        <Globe2 className="deck-ic text-blue-600" /><b className="text-slate-800">{fmt(PITCH_STATS.topics)}</b> {ui.topics}
      </Reveal>
    </div>
  );
}

// ------------------------------------------------------------------ 12. Xavfsizlik — ma'lumot oqimi

export function SecurityVisual({ ui }: { ui: UI }) {
  const still = useStatic();
  return (
    <div className="deck-visual space-y-[1em]">
      <Reveal delay={0.3}>
        <Card glow>
          <div className="deck-flow">
            <div className="deck-node"><span className="deck-node-ic"><Database className="deck-ic" /></span><div><b>{ui.hemis}</b><span>{ui.l1}</span></div></div>
            <div className="deck-wire">
              {!still && <><span className="deck-packet" /><span className="deck-packet deck-packet-2" /></>}
              <em><Lock className="deck-ic" />{ui.readOnly}</em>
            </div>
            <div className="deck-node deck-node-main"><span className="deck-node-ic"><Server className="deck-ic" /></span><div><b>{ui.server}</b><span>{ui.serverSub}</span></div><ShieldCheck className="deck-ic ml-auto text-emerald-600" /></div>
            <div className="deck-wire deck-wire-ai">
              {!still && <span className="deck-packet deck-packet-violet" />}
              <em><Sparkles className="deck-ic" />{ui.l3b}<span className="deck-blocked"><X className="deck-ic" strokeWidth={3} />{ui.blocked}</span></em>
            </div>
            <div className="deck-node"><span className="deck-node-ic deck-node-ic-violet"><Sparkles className="deck-ic" /></span><div><b>{ui.ai}</b><span>{ui.l3}</span></div></div>
          </div>
        </Card>
      </Reveal>
      <Reveal delay={0.55}>
        <Card>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-semibold text-slate-800"><Wallet className="deck-ic text-blue-600" />{ui.cost}</span>
            <span className="deck-mono text-[0.85em] text-slate-500">10 / 10</span>
          </div>
          <div className="deck-split mt-[0.7em]">
            <motion.span initial={still ? false : { width: '0%' }} animate={{ width: '80%' }} transition={{ duration: 1.2, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}>{ui.bank} · 8</motion.span>
            <span>{ui.fresh} · 2</span>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}

// ------------------------------------------------------------------ 15. Yakun — QR kod

export function ClosingVisual({ ui, needs }: { ui: UI; needs: string[] }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL('https://imentor.uz/taqdimot', { margin: 1, width: 360, color: { dark: '#0b1220', light: '#ffffff' } })
      .then((d: string) => { if (alive) setQr(d); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return (
    <div className="deck-visual grid grid-cols-[1fr_auto] items-center gap-[1.2em]">
      <Reveal delay={0.35}>
        <Card glow>
          <p className="deck-label">{ui.need}</p>
          <ul className="mt-[0.8em] space-y-[0.6em]">
            {needs.map((b, i) => (
              <Reveal key={b} delay={0.6 + i * 0.15} x={-12} y={0}>
                <li className="flex items-center gap-[0.6em] text-slate-800"><span className="deck-tick"><Check strokeWidth={3} /></span>{b}</li>
              </Reveal>
            ))}
          </ul>
          <a className="deck-site mt-[1.1em]" href="/">{ui.site}<ArrowRight className="deck-ic" /></a>
        </Card>
      </Reveal>
      <Reveal delay={0.7} scale={0.85} className="deck-qr">
        {qr ? <img src={qr} alt="imentor.uz/taqdimot" /> : <div className="deck-qr-empty" />}
        <span>{ui.scan}</span>
      </Reveal>
    </div>
  );
}
