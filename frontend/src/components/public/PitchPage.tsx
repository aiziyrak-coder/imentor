/**
 * `imentor.uz/taqdimot` — boshqa universitetlar rektorlari va hamkorlar uchun JONLI slayd-taqdimot.
 *
 * 2026-11-13 (v2): "qiziq emas, jozibador emas — yorug'ligicha qolsin, lekin tushunarli, effekt va animatsiyaga
 * boy bo'lsin". Har slayd — qisqa hikoya: sarlavha so'zma-so'z chiqadi, raqamlar noldan sanaydi, o'ngdagi
 * interfeys bo'lagi ko'z oldida ishlaydi (`deck/visuals.tsx`). Slaydlar yo'nalishga qarab almashadi.
 *
 * Boshqaruv: ← → / bo'sh joy / PageUp-PageDown / Home-End; F — to'liq ekran; O — barcha slaydlar; P — avto-namoyish;
 * sichqoncha bilan slayd ustiga bosish — keyingisi; telefonda surish. `#5` — 5-slayd; `?lang=ru`; `?static=1` —
 * animatsiyasiz (skrinshot, chop etish). Kirishsiz ochiladi, serverga so'rov yubormaydi.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowRight, BookOpen, Bot, ChevronLeft, FileDown, ChevronRight, ClipboardCheck, Clock3, Copy, Database, EyeOff, FileText, Grid3x3, Languages, MonitorX,
  Handshake, LayoutGrid, Library, LineChart, Maximize2, Minimize2, MonitorPlay, Pause, Play, Presentation, QrCode,
  ScanFace, Send, Settings2, ShieldCheck, Sparkles, Stethoscope, Users, X,
} from 'lucide-react';
import { DECK_CHROME, DECK_TEXT, PITCH_STATS, type DeckSlide, type DeckText, type PitchLang } from './pitchContent';
import { Reveal, SPRING, StaticCtx, WordsTitle, useCountUp, useStatic, useStory } from './deck/anim';
import {
  Caption, ClosingVisual, LanguagesVisual, LiveVisual, QualityVisual, RectorVisual, ReasonsVisual, SecurityVisual,
  StudentVisual, TeacherVisual, TitleVisual,
} from './deck/visuals';
import { DECK_CSS } from './deck/deckCss';

const LANG_KEY = 'imentor-pitch-lang';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap';
const AUTOPLAY_MS = 14000;

function initialLang(): PitchLang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'uz' || q === 'ru' || q === 'en') return q;
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'uz' || saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* maxfiy rejim — sukut */
  }
  return 'uz';
}

function isPrintMode(): boolean {
  try { return new URLSearchParams(window.location.search).get('print') === '1'; } catch { return false; }
}

function isStaticMode(): boolean {
  try {
    if (isPrintMode()) return true;
    if (new URLSearchParams(window.location.search).get('static') === '1') return true;
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

function indexFromHash(total: number): number {
  const n = parseInt((window.location.hash || '').replace('#', ''), 10);
  return Number.isFinite(n) && n >= 1 && n <= total ? n - 1 : 0;
}

function formatNumber(n: number, lang: PitchLang): string {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(Math.round(n)).replace(/[,  ]/g, ' ');
}

function formatDate(iso: string, lang: PitchLang): string {
  const d = new Date(`${iso}T00:00:00`);
  const months = {
    uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  }[lang];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function Kicker({ n, label }: { n: number; label: string }) {
  const still = useStatic();
  return (
    <p className="deck-kicker">
      <span>{pad(n)}</span>
      <motion.span className="deck-kicker-line" aria-hidden initial={still ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, delay: 0.1 }} />
      <span>{label}</span>
    </p>
  );
}

function Bullets({ items, delay = 0.45 }: { items: string[]; delay?: number }) {
  return (
    <ul className="deck-bullets">
      {items.map((b, i) => (
        <Reveal key={b} delay={delay + i * 0.12} x={-16} y={0}>
          <li><span className="deck-tick" aria-hidden><Check3 /></span><span>{b}</span></li>
        </Reveal>
      ))}
    </ul>
  );
}

function Check3() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}

// ------------------------------------------------------------------ katta raqamlar

function StatNumber({ value, suffix = '', lang, delay }: { value: number; suffix?: string; lang: PitchLang; delay: number }) {
  const v = useCountUp(value, { duration: 1.8, delay });
  return <>{formatNumber(v, lang)}{suffix}</>;
}

function Ring({ value, label, delay = 0.3 }: { value: number; label: string; delay?: number }) {
  const still = useStatic();
  const v = useCountUp(value, { duration: 1.8, delay });
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="deck-ring">
      <svg viewBox="0 0 128 128">
        <defs>
          <linearGradient id="deck-ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2563eb" /><stop offset="1" stopColor="#06b6d4" /></linearGradient>
        </defs>
        <circle cx="64" cy="64" r={r} className="deck-ring-bg" />
        <motion.circle cx="64" cy="64" r={r} className="deck-ring-fg" stroke="url(#deck-ring-g)" strokeDasharray={c}
          initial={still ? false : { strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1.8, delay, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <div className="deck-ring-center"><b>{Math.round(v)}%</b><span>{label}</span></div>
    </div>
  );
}

const STAT_ICONS = [MonitorPlay, Users, QrCode, Send, Sparkles];

// ------------------------------------------------------------------ slayd tanasi

function SlideBody({ slide, n, t, lang }: { slide: DeckSlide; n: number; t: DeckText; lang: PitchLang }) {
  const ui = slide.ui || {};
  const kicker = <Kicker n={n} label={slide.section} />;
  const title = <WordsTitle text={slide.title} level={n === 1 ? 1 : 2} />;

  if (slide.kind === 'title') {
    return (
      <div className="deck-split-2">
        <div className="deck-col">
          <Reveal y={8}><p className="deck-kicker"><img className="deck-mark" src="/imentor-mark.png" alt="" /><span>{ui.kicker}</span></p></Reveal>
          <div className="deck-title-xl">{title}</div>
          <Reveal delay={0.7}><p className="deck-lead">{slide.lead}</p></Reveal>
          <Reveal delay={0.85}><p className="deck-note">{slide.note}</p></Reveal>
        </div>
        <div className="deck-stagepanel"><TitleVisual ui={ui} /><div className="pt-[1.4em]"><Caption text={ui.caption} /></div></div>
      </div>
    );
  }

  if (slide.kind === 'stats') {
    const [first, ...rest] = slide.stats || [];
    return (
      <div className="deck-col">
        {kicker}
        {title}
        <Reveal delay={0.4}><p className="deck-lead">{slide.lead}</p></Reveal>
        <div className="deck-stats-wrap">
          {first && (
            <Reveal delay={0.45} scale={0.9}>
              <Ring value={PITCH_STATS[first.key] as number} label={first.label} />
            </Reveal>
          )}
          <div className="deck-stats">
            {rest.map((s, i) => {
              const I = STAT_ICONS[i % STAT_ICONS.length];
              return (
                <Reveal key={s.key} delay={0.6 + i * 0.1} className="deck-stat">
                  <span className="deck-stat-ic"><I className="deck-ic" /></span>
                  <p className="deck-stat-num"><StatNumber value={PITCH_STATS[s.key] as number} suffix={s.suffix} lang={lang} delay={0.6 + i * 0.1} /></p>
                  <p className="deck-stat-label">{s.label}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
        <Reveal delay={1.2}><p className="deck-note">{t.asOf}: {formatDate(PITCH_STATS.asOf, lang)} · {ui.caption}</p></Reveal>
      </div>
    );
  }

  if (slide.kind === 'problems') return <ProblemsBody slide={slide} kicker={kicker} title={title} />;

  if (slide.kind === 'how' || slide.kind === 'rollout') return <StepsBody slide={slide} kicker={kicker} title={title} rollout={slide.kind === 'rollout'} />;

  if (slide.kind === 'modules') return <ModulesBody slide={slide} kicker={kicker} title={title} />;

  if (slide.kind === 'closing') {
    return (
      <div className="deck-split-2">
        <div className="deck-col">
          {kicker}
          {title}
          <Reveal delay={0.6}><p className="deck-lead">{slide.lead}</p></Reveal>
          <Reveal delay={0.9}>
            <span className="deck-thanks-wrap">
              <p className="deck-thanks">{ui.thanks}</p>
              <i className="deck-spark" /><i className="deck-spark" /><i className="deck-spark" /><i className="deck-spark" />
            </span>
          </Reveal>
        </div>
        <div className="deck-stagepanel"><ClosingVisual ui={ui} needs={slide.bullets || []} /><Caption text={ui.caption} /></div>
      </div>
    );
  }

  const visual = {
    teacher: <TeacherVisual ui={ui} />,
    quality: <QualityVisual ui={ui} />,
    live: <LiveVisual ui={ui} />,
    student: <StudentVisual ui={ui} />,
    rector: <RectorVisual ui={ui} />,
    reasons: <ReasonsVisual ui={ui} />,
    languages: <LanguagesVisual ui={ui} />,
    security: <SecurityVisual ui={ui} />,
  }[slide.kind as 'teacher'];

  return (
    <div className="deck-split-2">
      <div className="deck-col">
        {kicker}
        {title}
        {slide.bullets && <Bullets items={slide.bullets} />}
      </div>
      <div className="deck-stagepanel">{visual}<Caption text={ui.caption} /></div>
    </div>
  );
}

function ProblemsBody({ slide, kicker, title }: { slide: DeckSlide; kicker: React.ReactNode; title: React.ReactNode }) {
  const still = useStatic();
  return (
    <div className="deck-col">
      {kicker}
      {title}
      <div className="deck-pairs">
        {(slide.pairs || []).map((p, i) => {
          const d = 0.5 + i * 0.28;
          return (
            <Reveal key={p.problem} delay={d - 0.25} className="deck-pair">
              <span className="deck-pair-ic">{React.createElement(PROBLEM_ICONS[i % PROBLEM_ICONS.length], { className: 'deck-ic' })}</span>
              <p className="deck-problem">
                <span>{p.problem}</span>
                <motion.i className="deck-strike" initial={still ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.45, delay: d + 0.15 }} />
              </p>
              <motion.p className="deck-answer" initial={still ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: d + 0.45 }}>
                <ArrowRight className="deck-ic text-emerald-600" strokeWidth={2.5} />{p.answer}
              </motion.p>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}

const PROBLEM_ICONS = [Clock3, EyeOff, MonitorX, Copy, Languages, Bot];
const HOW_ICONS = [Database, Sparkles, MonitorPlay, LineChart];
const ROLLOUT_ICONS = [Presentation, Settings2, Users, Handshake];

function StepsBody({ slide, kicker, title, rollout }: { slide: DeckSlide; kicker: React.ReactNode; title: React.ReactNode; rollout: boolean }) {
  const still = useStatic();
  const steps = slide.steps || [];
  const icons = rollout ? ROLLOUT_ICONS : HOW_ICONS;
  const active = useStory([...steps.map(() => 900), 3600], steps.length, { startDelay: 600 });
  return (
    <div className="deck-col">
      {kicker}
      {title}
      <div className="deck-steps">
        <div className="deck-steps-line" aria-hidden>
          <motion.span initial={still ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.6, delay: 0.5, ease: [0.16, 1, 0.3, 1] }} />
          {!still && <span className="deck-steps-dot" />}
        </div>
        {steps.map((s, i) => {
          const I = icons[i % icons.length];
          const last = i === steps.length - 1;
          const lit = still || active >= i;
          return (
            <Reveal key={s.title} delay={0.5 + i * 0.22} className={`deck-step ${last ? 'deck-step-last' : ''} ${lit ? 'deck-step-lit' : ''}`}>
              <motion.span className={`deck-step-ic ${lit ? 'deck-step-ic-on' : ''}`} animate={lit && !still ? { scale: [1, 1.18, 1] } : { scale: 1 }} transition={{ duration: 0.5 }}>
                <I className="deck-ic" />
              </motion.span>
              <p className="deck-mono deck-step-n">{pad(i + 1)}</p>
              <p className="deck-step-title">{s.title}</p>
              <p className="deck-step-text">{s.text}</p>
              <p className="deck-step-value">{s.value}</p>
            </Reveal>
          );
        })}
      </div>
      {slide.ui?.caption && <Reveal delay={1.4}><p className="deck-note">{slide.ui.caption}</p></Reveal>}
    </div>
  );
}

const MODULE_ICONS = [FileText, Presentation, Stethoscope, QrCode, MonitorPlay, Library, ClipboardCheck, LineChart, BookOpen, Send, ScanFace, Database];

function ModulesBody({ slide, kicker, title }: { slide: DeckSlide; kicker: React.ReactNode; title: React.ReactNode }) {
  const mods = slide.modules || [];
  const sweep = useStory([...mods.map(() => 380), 2200], mods.length, { startDelay: 1500 });
  return (
    <div className="deck-col">
      {kicker}
      {title}
      <div className="deck-modules">
        {mods.map((m, i) => {
          const I = MODULE_ICONS[i % MODULE_ICONS.length];
          return (
            <Reveal key={m} delay={0.35 + i * 0.06} scale={0.9} className={`deck-module ${sweep === i ? 'deck-module-on' : ''}`}>
              <span className="deck-row-ic"><I className="deck-ic" /></span>
              <span>{m}</span>
            </Reveal>
          );
        })}
      </div>
      {slide.ui?.caption && <Reveal delay={1.3}><p className="deck-note">{slide.ui.caption}</p></Reveal>}
    </div>
  );
}

// ------------------------------------------------------------------ umumiy ko'rinish (O)

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  title: Sparkles, stats: LineChart, problems: Clock3, how: Settings2, teacher: FileText, quality: BookOpen,
  live: MonitorPlay, student: ScanFace, rector: LineChart, reasons: ClipboardCheck, languages: Languages,
  security: ShieldCheck, modules: LayoutGrid, rollout: Handshake, closing: QrCode,
};

function Overview({ t, index, onPick, onClose, closeLabel, title }: {
  t: DeckText; index: number; onPick: (i: number) => void; onClose: () => void; closeLabel: string; title: string;
}) {
  return (
    <motion.div className="deck-overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-label={title}>
      <div className="deck-overview-head">
        <p><LayoutGrid className="deck-ic" />{title}</p>
        <button type="button" className="deck-btn" onClick={onClose} aria-label={closeLabel}><X /></button>
      </div>
      <div className="deck-overview-grid">
        {t.slides.map((s, i) => (
          <motion.button key={i} type="button" className={`deck-thumb ${i === index ? 'on' : ''}`} onClick={() => onPick(i)}
            initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...SPRING, delay: i * 0.025 }}>
            <span className="deck-thumb-n">{pad(i + 1)}</span>
            <span className="deck-thumb-ic">{React.createElement(KIND_ICONS[s.kind] || Sparkles, { className: 'deck-ic' })}</span>
            <span className="deck-thumb-sec">{s.section}</span>
            <span className="deck-thumb-title">{s.title.replace(/\[\[|\]\]/g, '')}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------------ sahifa

export default function PitchPage() {
  const [lang, setLang] = useState<PitchLang>(initialLang);
  const [still] = useState(isStaticMode);
  const t = DECK_TEXT[lang];
  const chrome = DECK_CHROME[lang];
  const total = t.slides.length;
  const [index, setIndex] = useState(() => indexFromHash(total));
  const [dir, setDir] = useState(1);
  const [isFull, setIsFull] = useState(false);
  const [overview, setOverview] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  // Birinchi ochilishda qisqa kirish (sessiyada bir marta) va taqdimotchiga boshqaruv maslahati.
  const [intro, setIntro] = useState(() => {
    if (still) return false;
    try { return sessionStorage.getItem('imentor-deck-intro') !== '1'; } catch { return false; }
  });
  const [tip, setTip] = useState(false);
  const [idle, setIdle] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  useEffect(() => {
    if (!intro) return undefined;
    try { sessionStorage.setItem('imentor-deck-intro', '1'); } catch { /* ignore */ }
    const id = window.setTimeout(() => setIntro(false), 1150);
    return () => window.clearTimeout(id);
  }, [intro]);

  useEffect(() => {
    if (still || !window.matchMedia?.('(pointer: fine)').matches) return undefined;
    const show = window.setTimeout(() => setTip(true), 1500);
    const hide = window.setTimeout(() => setTip(false), 6500);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [still]);

  // To'liq ekranda sichqoncha 2,5 s qimirlamasa — kursor yashirinadi (taqdimotchiga xalaqit bermasin).
  useEffect(() => {
    if (!isFull) { setIdle(false); return undefined; }
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); window.clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 2500); };
    window.addEventListener('pointermove', wake);
    return () => { window.clearTimeout(timer); window.removeEventListener('pointermove', wake); };
  }, [isFull]);

  const go = useCallback((next: number) => {
    const i = Math.max(0, Math.min(total - 1, next));
    setIndex((cur) => { setDir(i >= cur ? 1 : -1); return i; });
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${i + 1}`);
    } catch {
      /* ignore */
    }
  }, [total]);

  useEffect(() => { document.title = `iMentor — ${t.slides[index].section} · ${index + 1}/${total}`; }, [index, t, total]);

  useEffect(() => {
    const onHash = () => setIndex(indexFromHash(total));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [total]);

  const toggleFull = useCallback(() => {
    if (!document.fullscreenElement) void rootRef.current?.requestFullscreen?.().catch(() => undefined);
    else void document.exitFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Avto-namoyish: har slayd AUTOPLAY_MS; oxirida to'xtaydi.
  useEffect(() => {
    if (!autoplay) return undefined;
    if (index >= total - 1) { setAutoplay(false); return undefined; }
    const id = window.setTimeout(() => go(index + 1), AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, index, total, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Tugma yoki havola tanlangan bo'lsa Enter/bo'sh joy o'sha tugmaniki — slayd almashmaydi.
      if ((tag === 'BUTTON' || tag === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
      if (overview) {
        if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') { e.preventDefault(); setOverview(false); }
        return;
      }
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(index + 1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(index - 1); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(total - 1); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFull(); }
      else if (e.key === 'o' || e.key === 'O' || e.key === 'Escape') { e.preventDefault(); setOverview((v) => (e.key === 'Escape' ? false : !v)); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setAutoplay((v) => !v); }
      else if (/^[0-9]$/.test(e.key)) { e.preventDefault(); go(e.key === '0' ? 9 : Number(e.key) - 1); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setNotesOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, index, total, toggleFull, overview]);

  // Yengil "parallaks": fon dog'lari sichqonchaga ergashadi.
  useEffect(() => {
    if (still) return undefined;
    const el = rootRef.current;
    if (!el || !window.matchMedia?.('(pointer: fine)').matches) return undefined;
    const onMove = (e: PointerEvent) => {
      el.style.setProperty('--mx', String((e.clientX / window.innerWidth - 0.5).toFixed(3)));
      el.style.setProperty('--my', String((e.clientY / window.innerHeight - 0.5).toFixed(3)));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [still]);

  const chooseLang = (l: PitchLang) => {
    setLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  };

  const onFrameClick = (e: React.MouseEvent) => {
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    if ((e.target as HTMLElement).closest('a,button')) return;
    const rect = frameRef.current?.getBoundingClientRect();
    if (rect && e.clientX < rect.left + rect.width * 0.25) go(index - 1);
    else go(index + 1);
  };

  const slide = t.slides[index];
  const n = index + 1;
  const progress = useMemo(() => `${(n / total) * 100}%`, [n, total]);

  // PDF / chop etish: barcha slaydlar animatsiyasiz, har biri alohida sahifada (`?print=1`).
  const [printMode] = useState(isPrintMode);
  useEffect(() => {
    if (!printMode) return undefined;
    let done = false;
    const run = () => { if (!done) { done = true; window.setTimeout(() => window.print(), 300); } };
    const fallback = window.setTimeout(run, 2500);
    document.fonts?.ready.then(() => window.setTimeout(run, 900)).catch(() => undefined);
    return () => window.clearTimeout(fallback);
  }, [printMode]);
  if (printMode) {
    return (
      <StaticCtx.Provider value>
        <MotionConfig reducedMotion="always">
          <div className="deck-print deck-static">
            <style>{DECK_CSS}</style>
            {t.slides.map((s, i) => (
              <section key={i} className="deck-frame deck-print-page" aria-label={`${i + 1} / ${total}`}>
                <div className="deck-aura" aria-hidden /><div className="deck-grid" aria-hidden />
                <div className="deck-slide">
                  <span className="deck-watermark" aria-hidden>{pad(i + 1)}</span>
                  <div className="deck-body"><SlideBody slide={s} n={i + 1} t={t} lang={lang} /></div>
                </div>
                <footer className="deck-foot">
                  <span className="flex items-center gap-2"><img className="deck-mark deck-mark-sm" src="/imentor-mark.png" alt="" />{t.brand}</span>
                  <span className="deck-foot-mid">{s.section}</span>
                  <span>{pad(i + 1)} / {pad(total)}</span>
                </footer>
              </section>
            ))}
          </div>
        </MotionConfig>
      </StaticCtx.Provider>
    );
  }

  return (
    <StaticCtx.Provider value={still}>
      <MotionConfig reducedMotion={still ? 'always' : 'never'}>
        <div
          ref={rootRef}
          className={`deck-root ${still ? 'deck-static' : ''} ${idle ? 'deck-idle' : ''}`}
          onTouchStart={(e) => { const p = e.touches[0]; touch.current = { x: p.clientX, y: p.clientY }; }}
          onTouchEnd={(e) => {
            const s = touch.current;
            touch.current = null;
            if (!s) return;
            const p = e.changedTouches[0];
            const dx = p.clientX - s.x;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(p.clientY - s.y) * 1.5) go(index + (dx < 0 ? 1 : -1));
          }}
        >
          <style>{DECK_CSS}</style>
          <div className="deck-bg" aria-hidden><span className="b1" /><span className="b2" /><span className="b3" /><span className="b4" /></div>
          <div className="deck-topline" aria-hidden><span style={{ width: progress }} /></div>

          <main className="deck-stage">
            <section ref={frameRef} className="deck-frame" onClick={onFrameClick} aria-roledescription="slide" aria-label={`${n} / ${total} · ${slide.section}`}>
              <div className="deck-aura" aria-hidden /><div className="deck-grid" aria-hidden />
              <AnimatePresence initial={false} custom={dir} mode="popLayout">
                <motion.div
                  key={`${lang}-${index}`}
                  className="deck-slide"
                  custom={dir}
                  variants={{
                    enter: (d: number) => ({ opacity: 0, x: d * 70, scale: 0.985, filter: 'blur(8px)' }),
                    center: { opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' },
                    exit: (d: number) => ({ opacity: 0, x: d * -70, scale: 0.985, filter: 'blur(8px)' }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.span className="deck-watermark" aria-hidden initial={still ? false : { opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}>{pad(n)}</motion.span>
                  <div className="deck-body"><SlideBody slide={slide} n={n} t={t} lang={lang} /></div>
                </motion.div>
              </AnimatePresence>
              <footer className="deck-foot">
                <span className="flex items-center gap-2"><img className="deck-mark deck-mark-sm" src="/imentor-mark.png" alt="" />{t.brand}</span>
                <span className="deck-foot-mid">{slide.section}</span>
                <span>{pad(n)} / {pad(total)}</span>
              </footer>
              {autoplay && <motion.span key={`ap-${index}`} className="deck-autoplay-bar" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: AUTOPLAY_MS / 1000, ease: 'linear' }} />}
            </section>
          </main>

          <nav className="deck-nav" aria-label="Slides">
            <div className="flex items-center gap-2">
              <button type="button" className="deck-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t.prev}><ChevronLeft /></button>
              <button type="button" className="deck-btn" onClick={() => go(index + 1)} disabled={index === total - 1} aria-label={t.next}><ChevronRight /></button>
              <span className="deck-keys">{chrome.keys}</span>
            </div>
            <div className="deck-dots">
              {t.slides.map((s, i) => (
                <button key={i} type="button" aria-label={`${i + 1}. ${s.section}`} title={`${i + 1}. ${s.section}`} aria-current={i === index ? 'step' : undefined}
                  className={i === index ? 'on' : i < index ? 'past' : ''} onClick={() => go(i)} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="deck-count">{n} / {total}</span>
              <button type="button" className="deck-btn deck-btn-grid" onClick={() => setOverview(true)} aria-label={chrome.overview} title={chrome.overview}><Grid3x3 /></button>
              <button type="button" className={`deck-btn deck-btn-auto ${autoplay ? 'deck-btn-on' : ''}`} onClick={() => setAutoplay((v) => !v)} aria-label={autoplay ? chrome.stop : chrome.autoplay} title={autoplay ? chrome.stop : chrome.autoplay}>
                {autoplay ? <Pause /> : <Play />}
              </button>
              <div className="deck-langs" role="group" aria-label="Language">
                {(['uz', 'ru', 'en'] as PitchLang[]).map((l) => (
                  <button key={l} type="button" className={l === lang ? 'on' : ''} onClick={() => chooseLang(l)} aria-pressed={l === lang}>{l}</button>
                ))}
              </div>
              <button type="button" className="deck-btn deck-btn-text" onClick={toggleFull}>
                {isFull ? <Minimize2 /> : <Maximize2 />}<span>{isFull ? t.exitFullscreen : t.fullscreen}</span>
              </button>
              <a className="deck-btn deck-btn-text deck-btn-pdf" href={`/taqdimot?print=1&lang=${lang}`} target="_blank" rel="noreferrer" title={chrome.pdf}>
                <FileDown /><span>PDF</span>
              </a>
              <a className="deck-enter" href="/">{t.enter}</a>
            </div>
          </nav>

          <p className="deck-sr" aria-live="polite">{`${n} / ${total}. ${slide.title.replace(/\[\[|\]\]/g, '')}`}</p>

          <AnimatePresence>
            {notesOpen && slide.notes && (
              <motion.aside key={`notes-${index}-${lang}`} className="deck-notes" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} aria-label={chrome.notes}>
                <p className="deck-notes-head">{chrome.notes}</p>
                <p className="deck-notes-text">{slide.notes}</p>
              </motion.aside>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {tip && !overview && (
              <motion.div className="deck-tip" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                <kbd><ChevronLeft /></kbd><kbd><ChevronRight /></kbd>
                <span>{chrome.tip}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {intro && (
              <motion.div className="deck-intro" initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.45 }}>
                <motion.img src="/imentor-logo.png" alt="iMentor" className="deck-intro-logo" initial={{ opacity: 0, scale: 0.92, filter: 'blur(10px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ duration: 0.6 }} />
                <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }} />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {overview && (
              <Overview t={t} index={index} title={chrome.overview} closeLabel={chrome.close}
                onClose={() => setOverview(false)} onPick={(i) => { setOverview(false); go(i); }} />
            )}
          </AnimatePresence>
        </div>
      </MotionConfig>
    </StaticCtx.Provider>
  );
}

