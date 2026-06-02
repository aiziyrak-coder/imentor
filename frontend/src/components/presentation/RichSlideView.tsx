import React from 'react';
import { motion } from 'motion/react';
import type { Slide } from '../../services/presentationTypes';
import MedicalSlideVisual from './MedicalSlideVisual';
type SlideTheme = {
  textClass: string;
  textMutedClass: string;
  badgeClass: string;
  bulletClass: string;
};

type Props = {
  slide: Slide;
  slideIndex: number;
  totalSlides: number;
  topic: string;
  theme: SlideTheme;
  variant?: 'editor' | 'presenter';
  transitionEffect?: 'fade' | 'slide' | 'zoom';
};

export default function RichSlideView({
  slide,
  slideIndex,
  totalSlides,
  topic,
  theme,
  variant = 'editor',
  transitionEffect = 'fade',
}: Props) {
  const layout = slide.layout || (slideIndex === 0 ? 'title' : 'split');
  const isPresenter = variant === 'presenter';
  const titleCls = isPresenter
    ? 'text-3xl md:text-5xl'
    : layout === 'title'
      ? 'text-4xl md:text-5xl lg:text-6xl'
      : 'text-2xl md:text-3xl';

  const bulletCls = isPresenter
    ? 'text-lg md:text-2xl'
    : 'text-base md:text-lg';

  const visualPanel = (
    <div
      className={`rounded-2xl overflow-hidden border border-black/10 bg-gradient-to-br from-slate-50 to-sky-50/40 shadow-inner flex items-center justify-center p-3 ${
        layout === 'full-visual' ? 'min-h-[280px]' : 'min-h-[200px] h-full'
      }`}
    >
      {slide.visual ? (
        <MedicalSlideVisual visual={slide.visual} variant={variant} />
      ) : slide.imageUrl ? (
        <img src={slide.imageUrl} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
      ) : null}
    </div>
  );

  const bullets = (slide.content || []).slice(0, layout === 'title' ? 2 : 4);

  const headerBadge = !isPresenter && layout !== 'title' && (
    <div className="flex items-center gap-4 mb-4">
      <div className={`px-3 py-1 border rounded-lg text-[12px] font-mono font-medium backdrop-blur-md ${theme.badgeClass}`}>
        {slideIndex + 1}
      </div>
      <span className={`${theme.textMutedClass} opacity-60 font-medium text-[13px] tracking-wide truncate`}>
        {topic}
      </span>
      {slide.slideKind && (
        <span className="text-[10px] uppercase tracking-wider font-bold text-sky-600/70 ml-auto">
          {slide.slideKind}
        </span>
      )}
    </div>
  );

  const keyTakeaway = slide.keyTakeaway?.trim() && layout !== 'title' && (
    <div className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[12px] font-semibold text-amber-950 leading-snug">
      ★ {slide.keyTakeaway}
    </div>
  );

  const bulletList = (
    <ul className="space-y-2 md:space-y-3">
      {bullets.map((point, pi) => (
        <motion.li
          key={pi}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 + pi * 0.08 }}
          className={`flex items-start gap-3 ${theme.textMutedClass} font-medium leading-snug ${bulletCls}`}
        >
          <div className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${theme.bulletClass}`} />
          <span>{point}</span>
        </motion.li>
      ))}
    </ul>
  );

  return (
    <motion.div
      key={slideIndex}
      initial={
        transitionEffect === 'slide'
          ? { opacity: 0, x: 40 }
          : transitionEffect === 'zoom'
            ? { opacity: 0, scale: 0.92 }
            : { opacity: 0 }
      }
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="relative z-10 flex flex-col h-full min-h-0"
    >
      {headerBadge}

      {layout === 'title' && (
        <div className="flex flex-col items-center justify-center flex-1 text-center max-w-4xl mx-auto px-2">
          <h1 className={`font-bold mb-4 leading-tight tracking-tight ${theme.textClass} ${titleCls}`}>
            {slide.title}
          </h1>
          {slide.subtitle && (
            <p className={`text-lg md:text-xl ${theme.textMutedClass} mb-4`}>{slide.subtitle}</p>
          )}
          <div className="w-full max-w-lg mt-2">{visualPanel}</div>
          {bullets.length > 0 && (
            <p className={`mt-4 text-base ${theme.textMutedClass}`}>{bullets.join(' · ')}</p>
          )}
        </div>
      )}

      {layout === 'full-visual' && (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
          <h1 className={`font-bold ${theme.textClass} ${titleCls} leading-tight`}>{slide.title}</h1>
          {visualPanel}
          {keyTakeaway}
        </div>
      )}

      {layout === 'visual-focus' && (
        <div className="relative flex-1 min-h-0 rounded-2xl overflow-hidden">
          <div className="absolute inset-0 p-3">{visualPanel}</div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-6 pt-16">
            <h1 className="font-bold text-white text-2xl md:text-3xl mb-2">{slide.title}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/90 text-sm">{bullets.join(' • ')}</div>
          </div>
        </div>
      )}

      {(layout === 'split' || layout === 'standard') && (
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 flex-1 min-h-0 items-stretch">
          <div className="flex-1 flex flex-col justify-center min-w-0 lg:max-w-[46%]">
            <h1 className={`font-bold mb-4 leading-tight ${theme.textClass} ${titleCls}`}>{slide.title}</h1>
            {slide.subtitle && (
              <p className={`text-sm ${theme.textMutedClass} mb-3 -mt-2`}>{slide.subtitle}</p>
            )}
            {bulletList}
            {keyTakeaway}
          </div>
          <div className="flex-1 min-h-[200px] lg:min-h-0">{visualPanel}</div>
        </div>
      )}
    </motion.div>
  );
}
