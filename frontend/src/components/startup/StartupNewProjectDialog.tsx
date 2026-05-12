import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';

const DEFAULT_TITLES = new Set(['yangi startap loyiha', 'yangi ilmiy loyiha', 'loyihasiz']);

function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Yangi loyiha: faqat nom + qisqa matn (keyin savolnoma shu asosda).
 */
export default function StartupNewProjectDialog({
  open,
  domain,
  saving,
  onClose,
  onConfirm,
}: {
  open: boolean;
  domain: 'startup' | 'research';
  saving: boolean;
  onClose: () => void;
  onConfirm: (payload: { title: string; summary: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (open) {
      setTitle('');
      setSummary('');
    }
  }, [open]);

  if (!open) return null;

  const titleOk = title.trim().length >= 4 && !DEFAULT_TITLES.has(normTitle(title));
  const summaryOk = summary.trim().length >= 40;
  const canSubmit = titleOk && summaryOk && !saving;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({ title: title.trim(), summary: summary.trim() });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
    >
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl border border-black/10 overflow-hidden max-h-[min(92vh,640px)] flex flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-black/8 bg-violet-50/80 shrink-0">
          <h2 id="new-project-title" className="text-[15px] font-bold text-black/90">
            {domain === 'research' ? 'Yangi tadqiqot loyihasi' : 'Yangi startap loyihasi'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-xl hover:bg-black/5 text-black/60 disabled:opacity-40"
            aria-label="Yopish"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <p className="text-[12px] text-black/55 leading-relaxed">
            Avvalo faqat nom va qisqa tavsif kiritiladi. Keyin saqlangan loyihada savolnoma yaratiladi — qo‘shimcha
            maydonlar ixtiyoriy.
          </p>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-black/50">Loyiha nomi</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-violet-400/40"
              placeholder="Masalan: Kampus tele-triage piloti"
              autoFocus
            />
            {!titleOk && title.trim().length > 0 && (
              <p className="text-[11px] text-amber-700">Kamida 4 belgi; standart «Yangi … loyiha» bo‘lmasin.</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-black/50">Loyiha haqida (qisqa)</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-[14px] outline-none resize-y min-h-[120px] focus:ring-2 focus:ring-violet-400/40"
              placeholder="Kim uchun, qanday muammo, nima taklif qilasiz — 2–6 jumla (kamida ~40 belgi)."
            />
            <p className="text-[11px] text-black/40 tabular-nums">{summary.trim().length} / 40+ belgi</p>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-black/8 bg-white flex flex-wrap gap-2 justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-black/12 px-4 py-2.5 text-[13px] font-semibold text-black/75 hover:bg-black/[0.03] disabled:opacity-50"
          >
            Bekor qilish
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm disabled:opacity-45"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : null}
            Yaratish
          </button>
        </div>
      </div>
    </div>
  );
}
