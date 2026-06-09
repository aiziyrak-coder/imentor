/** Tibbiy taqdimot — slayd va vizual bloklar (AI + renderer). */

export type SlideLayout = 'title' | 'split' | 'visual-focus' | 'full-visual' | 'standard';

export type SlideKind = 'title' | 'section' | 'content' | 'diagram' | 'clinical' | 'summary' | 'hook';

export type VisualBlockType =
  | 'flow'
  | 'stats'
  | 'compare'
  | 'pyramid'
  | 'timeline'
  | 'cycle'
  | 'table'
  | 'icon-grid'
  | 'clinical';

export interface VisualStep {
  label: string;
  detail?: string;
}

export interface VisualStat {
  label: string;
  value: string;
  unit?: string;
}

export interface VisualColumn {
  title: string;
  items: string[];
}

export interface VisualIconItem {
  icon: string;
  label: string;
  text: string;
}

export interface VisualBlock {
  type: VisualBlockType;
  caption?: string;
  steps?: VisualStep[];
  stats?: VisualStat[];
  left?: VisualColumn;
  right?: VisualColumn;
  levels?: { label: string; items: string[] }[];
  events?: { time: string; text: string }[];
  nodes?: { id: string; label: string }[];
  links?: { from: string; to: string; label?: string }[];
  rows?: string[][];
  icons?: VisualIconItem[];
  vignette?: { patient: string; findings: string[]; question: string };
}

export interface Slide {
  title: string;
  subtitle?: string;
  content: string[];
  layout?: SlideLayout;
  slideKind?: SlideKind;
  visual?: VisualBlock;
  keyTakeaway?: string;
  notes?: string;
  imagePrompt?: string;
  imageUrl?: string;
  /** Mermaid diagramma kodi (flow/cycle slaydlar uchun). */
  mermaid?: string;
}
