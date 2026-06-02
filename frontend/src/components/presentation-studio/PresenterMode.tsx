import React, { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Slide } from '../../services/presentationTypes';
import SlideStage from './SlideStage';
import type { StudioTheme } from './themes';

type Props = {
  slides: Slide[];
  index: number;
  topic: string;
  theme: StudioTheme;
  onIndexChange: (i: number) => void;
  onClose: () => void;
};

export default function PresenterMode({
  slides,
  index,
  topic,
  theme,
  onIndexChange,
  onClose,
}: Props) {
  const slide = slides[index];
  const hasPrev = index > 0;
  const hasNext = index < slides.length - 1;

  const goPrev = useCallback(() => {
    if (hasPrev) onIndexChange(index - 1);
  }, [hasPrev, index, onIndexChange]);

  const goNext = useCallback(() => {
    if (hasNext) onIndexChange(index + 1);
  }, [hasNext, index, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext, onClose]);

  useEffect(() => {
    const el = document.documentElement;
    void el.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  if (!slide) return null;

  return (
    <div className="fixed inset-0 z-[300] bg-black flex flex-col">
      <div className="flex-1 p-3 md:p-6 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            className="w-full h-full max-w-[1600px] mx-auto"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <SlideStage
              slide={slide}
              index={index}
              total={slides.length}
              topic={topic}
              theme={theme}
              mode="presenter"
            />
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="shrink-0 flex items-center justify-between px-4 py-3 bg-black/80 border-t border-white/10">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-white/80 hover:bg-white/10 text-sm font-medium"
        >
          <X size={18} /> Chiqish
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={goPrev}
            className="p-3 rounded-full bg-white/10 text-white disabled:opacity-30 hover:bg-white/20"
          >
            <ChevronLeft size={24} />
          </button>
          <span className="text-white/70 text-sm font-mono min-w-[4rem] text-center">
            {index + 1} / {slides.length}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={goNext}
            className="p-3 rounded-full bg-white/10 text-white disabled:opacity-30 hover:bg-white/20"
          >
            <ChevronRight size={24} />
          </button>
        </div>
        <p className="text-white/50 text-xs max-w-[200px] truncate hidden sm:block">{slide.notes}</p>
      </footer>
    </div>
  );
}
