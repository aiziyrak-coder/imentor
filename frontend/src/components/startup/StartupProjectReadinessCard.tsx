import React from 'react';
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import type { ReadinessItem } from '../../utils/startupProjectQuality';

export default function StartupProjectReadinessCard({
  percent,
  items,
  canRunAi,
  blockMessages,
  compact,
}: {
  percent: number;
  items: ReadinessItem[];
  canRunAi: boolean;
  blockMessages: string[];
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border ${canRunAi ? 'border-emerald-200/90 bg-emerald-50/50' : 'border-amber-200/90 bg-amber-50/40'} p-4 shadow-sm`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-bold text-black/50 uppercase tracking-wide">Loyiha tayyorgarligi</p>
          <p className="text-[13px] font-semibold text-black/85 mt-0.5">
            {canRunAi ? 'AI tahlil uchun yetarli ma’lumot' : 'AI tahlil uchun maydonlarni kuchaytiring'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-28 h-2 rounded-full bg-black/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${canRunAi ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-[12px] font-bold tabular-nums text-black/70">{percent}%</span>
        </div>
      </div>

      {!compact && (
        <ul className="space-y-1.5 mb-3">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-2 text-[12px] text-black/80">
              {it.ok ? (
                <CheckCircle2 className="shrink-0 text-emerald-600 mt-0.5" size={16} />
              ) : (
                <Circle className="shrink-0 text-amber-600 mt-0.5" size={16} />
              )}
              <span>
                <span className="font-semibold">{it.label}:</span> {it.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!canRunAi && blockMessages.length > 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-white/80 px-3 py-2.5 text-[12px] text-amber-950">
          <AlertTriangle className="shrink-0 text-amber-600 mt-0.5" size={16} />
          <ul className="list-disc pl-4 space-y-1">
            {blockMessages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
