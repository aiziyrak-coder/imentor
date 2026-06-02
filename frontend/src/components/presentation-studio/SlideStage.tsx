import React from 'react';
import { motion } from 'motion/react';
import type { Slide } from '../../services/presentationTypes';
import MedicalSlideVisual from '../presentation/MedicalSlideVisual';
import type { StudioTheme } from './themes';
import { layoutLabel } from './themes';

type Props = {
  slide: Slide;
  index: number;
  total: number;
  topic: string;
  theme: StudioTheme;
  mode?: 'editor' | 'presenter';
};

export default function SlideStage({ slide, index, total, topic, theme, mode = 'editor' }: Props) {
  const layout = slide.layout || (index === 0 ? 'title' : 'split');
  const isPresenter = mode === 'presenter';
  const accent = theme.accent;

  const bgOrbs = (
    <>
      <div className={`absolute -top-[20%] -right-[10%] w-[55%] h-[55%] rounded-full blur-[80px] ${theme.orb1}`} />
      <div className={`absolute -bottom-[15%] -left-[10%] w-[45%] h-[45%] rounded-full blur-[70px] ${theme.orb2}`} />
    </>
  );

  const progress = (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20 z-20">
      <motion.div
        className="h-full"
        style={{ background: theme.progress }}
        initial={{ width: 0 }}
        animate={{ width: `${((index + 1) / total) * 100}%` }}
        transition={{ duration: 0.4 }}
      />
    </div>
  );

  const metaBar = !isPresenter && (
    <div className="absolute top-4 left-4 right-4 z-20 flex items-center gap-2">
      <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${theme.badge}`}>
        {index + 1} / {total}
      </span>
      <span className={`text-[11px] font-medium truncate opacity-70 ${theme.mutedText}`}>{topic}</span>
      <span className={`ml-auto text-[10px] uppercase tracking-widest font-bold opacity-60 ${theme.mutedText}`}>
        {layoutLabel(layout)}
      </span>
    </div>
  );

  const visualCard = (
    <div
      className={`relative rounded-2xl overflow-hidden border ${theme.border} ${theme.panel} shadow-2xl flex-1 min-h-0`}
    >
      <div className="absolute inset-0 opacity-40" style={{ background: theme.accentSoft }} />
      <div className="relative z-10 p-3 sm:p-4 h-full flex items-center justify-center min-h-[180px]">
        {slide.visual ? (
          <MedicalSlideVisual visual={slide.visual} variant={isPresenter ? 'presenter' : 'editor'} accent={accent} />
        ) : slide.imageUrl ? (
          <img src={slide.imageUrl} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
        ) : null}
      </div>
    </div>
  );

  const bullets = (slide.content || []).slice(0, layout === 'title' ? 2 : 4);

  const bulletList = (
    <ul className={`space-y-2.5 ${isPresenter ? 'space-y-4' : ''}`}>
      {bullets.map((point, pi) => (
        <motion.li
          key={pi}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08 + pi * 0.06 }}
          className={`flex gap-3 leading-snug font-medium ${theme.mutedText} ${
            isPresenter ? 'text-xl md:text-2xl' : 'text-sm md:text-base'
          }`}
        >
          <span
            className="mt-2 w-2 h-2 rounded-full shrink-0 shadow-lg"
            style={{ background: accent, boxShadow: `0 0 12px ${accent}` }}
          />
          <span className={theme.bodyText}>{point}</span>
        </motion.li>
      ))}
    </ul>
  );

  const takeaway = slide.keyTakeaway?.trim() && (
    <div
      className={`mt-4 rounded-xl px-3 py-2.5 border ${theme.border} text-[12px] md:text-sm font-semibold leading-snug`}
      style={{ background: theme.accentSoft, color: accent }}
    >
      ★ {slide.keyTakeaway}
    </div>
  );

  if (layout === 'title') {
    return (
      <div
        className={`relative w-full h-full overflow-hidden rounded-2xl bg-gradient-to-br ${theme.canvas} flex flex-col items-center justify-center text-center px-8 py-12`}
      >
        {bgOrbs}
        {metaBar}
        {progress}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 max-w-4xl"
        >
          <p
            className={`text-[11px] md:text-xs font-bold uppercase tracking-[0.35em] mb-4 ${theme.mutedText}`}
          >
            {topic}
          </p>
          <h1
            className={`font-black tracking-tight leading-[1.05] mb-4 ${theme.titleText} ${
              isPresenter ? 'text-4xl md:text-6xl lg:text-7xl' : 'text-3xl md:text-5xl lg:text-6xl'
            }`}
          >
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p className={`text-lg md:text-2xl font-medium ${theme.mutedText}`}>{slide.subtitle}</p>
          )}
          {layout === 'title' && slide.visual && (
            <div className="mt-8 max-w-2xl mx-auto h-[200px]">{visualCard}</div>
          )}
        </motion.div>
      </div>
    );
  }

  if (layout === 'full-visual') {
    return (
      <div className={`relative w-full h-full overflow-hidden rounded-2xl bg-gradient-to-br ${theme.canvas} p-6 md:p-8 flex flex-col`}>
        {bgOrbs}
        {metaBar}
        {progress}
        <div className="relative z-10 flex flex-col flex-1 min-h-0 gap-4">
          <h2
            className={`font-bold tracking-tight ${theme.titleText} ${
              isPresenter ? 'text-3xl md:text-4xl' : 'text-2xl md:text-3xl'
            }`}
          >
            {slide.title}
          </h2>
          <div className="flex-1 min-h-0">{visualCard}</div>
          {takeaway}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden rounded-2xl bg-gradient-to-br ${theme.canvas} p-5 md:p-7 flex flex-col`}>
      {bgOrbs}
      {metaBar}
      {progress}
      <div className="relative z-10 flex flex-col flex-1 min-h-0 gap-4">
        <h2
          className={`font-bold tracking-tight ${theme.titleText} ${
            isPresenter ? 'text-2xl md:text-4xl' : 'text-xl md:text-2xl'
          }`}
        >
          {slide.title}
        </h2>
        <div
          className={`flex-1 min-h-0 grid gap-4 ${
            layout === 'visual-focus' ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
          }`}
        >
          <div className={`flex flex-col justify-center ${layout === 'visual-focus' ? 'order-2' : ''}`}>
            {bulletList}
            {takeaway}
          </div>
          <div className={layout === 'visual-focus' ? 'min-h-[240px]' : 'min-h-[200px] flex'}>{visualCard}</div>
        </div>
      </div>
    </div>
  );
}
