import type { SlideLayout } from '../../services/presentationTypes';

export type StudioThemeId =
  | 'aurora'
  | 'midnight-pro'
  | 'clinical-glass'
  | 'sunrise'
  | 'neon-lab'
  | 'mono-elite';

export type StudioTheme = {
  id: StudioThemeId;
  label: string;
  canvas: string;
  orb1: string;
  orb2: string;
  titleText: string;
  bodyText: string;
  mutedText: string;
  accent: string;
  accentSoft: string;
  panel: string;
  border: string;
  bullet: string;
  badge: string;
  progress: string;
};

export const STUDIO_THEMES: StudioTheme[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    canvas: 'from-[#0c1222] via-[#131a35] to-[#1a1040]',
    orb1: 'bg-cyan-500/25',
    orb2: 'bg-violet-500/30',
    titleText: 'text-white',
    bodyText: 'text-slate-100',
    mutedText: 'text-slate-300/90',
    accent: '#22d3ee',
    accentSoft: 'rgba(34,211,238,0.15)',
    panel: 'bg-white/10 backdrop-blur-xl border-white/15',
    border: 'border-white/20',
    bullet: 'bg-cyan-400',
    badge: 'bg-white/15 text-cyan-200 border-white/20',
    progress: 'bg-cyan-400',
  },
  {
    id: 'midnight-pro',
    label: 'Midnight Pro',
    canvas: 'from-slate-950 via-slate-900 to-indigo-950',
    orb1: 'bg-blue-600/20',
    orb2: 'bg-indigo-500/25',
    titleText: 'text-white',
    bodyText: 'text-slate-100',
    mutedText: 'text-slate-400',
    accent: '#60a5fa',
    accentSoft: 'rgba(96,165,250,0.12)',
    panel: 'bg-slate-800/50 backdrop-blur-xl border-slate-600/40',
    border: 'border-slate-500/30',
    bullet: 'bg-blue-400',
    badge: 'bg-slate-700/80 text-blue-200 border-slate-500/50',
    progress: 'bg-blue-500',
  },
  {
    id: 'clinical-glass',
    label: 'Clinical Glass',
    canvas: 'from-[#f0f9ff] via-white to-[#ecfeff]',
    orb1: 'bg-sky-300/40',
    orb2: 'bg-teal-200/50',
    titleText: 'text-slate-900',
    bodyText: 'text-slate-800',
    mutedText: 'text-slate-600',
    accent: '#0284c7',
    accentSoft: 'rgba(2,132,199,0.1)',
    panel: 'bg-white/70 backdrop-blur-xl border-sky-200/80',
    border: 'border-sky-200/90',
    bullet: 'bg-sky-600',
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
    progress: 'bg-sky-600',
  },
  {
    id: 'sunrise',
    label: 'Sunrise',
    canvas: 'from-amber-50 via-orange-50 to-rose-50',
    orb1: 'bg-orange-300/35',
    orb2: 'bg-rose-300/30',
    titleText: 'text-stone-900',
    bodyText: 'text-stone-800',
    mutedText: 'text-stone-600',
    accent: '#ea580c',
    accentSoft: 'rgba(234,88,12,0.12)',
    panel: 'bg-white/80 backdrop-blur-xl border-orange-200/70',
    border: 'border-orange-200/80',
    bullet: 'bg-orange-500',
    badge: 'bg-orange-50 text-orange-900 border-orange-200',
    progress: 'bg-orange-500',
  },
  {
    id: 'neon-lab',
    label: 'Neon Lab',
    canvas: 'from-[#050510] via-[#0a1628] to-[#061a14]',
    orb1: 'bg-emerald-400/20',
    orb2: 'bg-fuchsia-500/20',
    titleText: 'text-white',
    bodyText: 'text-emerald-50',
    mutedText: 'text-emerald-200/70',
    accent: '#34d399',
    accentSoft: 'rgba(52,211,153,0.15)',
    panel: 'bg-black/40 backdrop-blur-xl border-emerald-500/25',
    border: 'border-emerald-500/30',
    bullet: 'bg-emerald-400',
    badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40',
    progress: 'bg-emerald-400',
  },
  {
    id: 'mono-elite',
    label: 'Mono Elite',
    canvas: 'from-zinc-900 via-zinc-800 to-black',
    orb1: 'bg-white/5',
    orb2: 'bg-zinc-500/10',
    titleText: 'text-white',
    bodyText: 'text-zinc-100',
    mutedText: 'text-zinc-400',
    accent: '#fafafa',
    accentSoft: 'rgba(255,255,255,0.08)',
    panel: 'bg-zinc-800/60 backdrop-blur-xl border-zinc-600/50',
    border: 'border-zinc-500/40',
    bullet: 'bg-white',
    badge: 'bg-zinc-700 text-zinc-200 border-zinc-500',
    progress: 'bg-white',
  },
];

export function themeById(id: StudioThemeId): StudioTheme {
  return STUDIO_THEMES.find((t) => t.id === id) ?? STUDIO_THEMES[0];
}

export function layoutLabel(layout?: SlideLayout): string {
  switch (layout) {
    case 'title':
      return 'Sarlavha';
    case 'full-visual':
      return 'Infografika';
    case 'visual-focus':
      return 'Klinik fokus';
    case 'split':
      return 'Split';
    default:
      return 'Kontent';
  }
}
