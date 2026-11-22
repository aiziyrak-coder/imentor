import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type Props = {
  label: string;
  hint?: string;
};

/** "1:05" — necha vaqtdan beri kutilmoqda. */
export function elapsedText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Yaratish jarayoni. O'tgan vaqt soniyalab ko'rsatiladi (2026-11-19): o'qituvchi faqat aylanayotgan belgini ko'rib
 * "sahifa qotib qoldi" deb o'ylardi — raqam yurib turgani jarayon davom etayotganini ko'rsatadi.
 */
export default function StaffLoading({ label, hint }: Props) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3 py-20" role="status" aria-live="polite">
      <Loader2 size={22} className="animate-spin text-slate-300" />
      <p className="text-[13.5px] font-medium text-slate-500">{label}</p>
      <p className="text-[13px] font-semibold tabular-nums text-slate-400" data-testid="staff-loading-elapsed">
        {elapsedText((now - started) / 1000)}
      </p>
      {hint && (
        <p className="max-w-md px-4 text-center text-[12.5px] leading-relaxed text-slate-400">
          {hint}
        </p>
      )}
    </div>
  );
}
