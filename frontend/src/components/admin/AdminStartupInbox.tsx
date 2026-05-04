import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { listAdminStartupInbox, type StartupApplicationDto } from '../../utils/startupApplicationApi';

function shortJson(obj: unknown, max = 2000): string {
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}\n…`;
  } catch {
    return String(obj);
  }
}

export default function AdminStartupInbox() {
  const [rows, setRows] = useState<StartupApplicationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await listAdminStartupInbox();
      setRows(list);
    } catch {
      setError('Arizalarni olishda xato (admin yoki tizimdan kirishni tekshiring).');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 px-2 sm:px-4 pb-20">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-600 text-white flex items-center justify-center">
            <Inbox size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Startap arizalar (inbox)</h1>
            <p className="text-[12px] text-black/50">Faqat yuborilgan loyihalar</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-black/10 bg-white/90 px-4 py-2 text-[13px] font-semibold text-black/80 disabled:opacity-50"
        >
          Yangilash
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-black/50 gap-2">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : rows.length === 0 ? (
        <div className="ios-glass rounded-2xl border border-white/60 p-8 text-center text-[14px] text-black/55">
          Hozircha yuborilgan ariza yo‘q.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const expanded = openId === r.id;
            return (
              <div key={r.id} className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(expanded ? null : r.id)}
                  className="w-full text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-black/[0.03]"
                >
                  <div>
                    <p className="text-[14px] font-bold text-black/90">{r.title}</p>
                    <p className="text-[12px] text-black/50 line-clamp-2 mt-0.5">{r.summary || '—'}</p>
                  </div>
                  <div className="text-[11px] text-black/45 shrink-0">
                    {r.submitted_at
                      ? new Date(r.submitted_at).toLocaleString('uz-UZ')
                      : '—'}
                  </div>
                </button>
                {expanded && (
                  <div className="border-t border-black/10 px-4 py-4 space-y-3 bg-white/40 text-[13px]">
                    <div>
                      <span className="text-[11px] font-semibold text-black/45">Egasi (JWT)</span>
                      <p className="font-mono text-[12px] break-all">{r.owner_key}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-black/45">Ishtirokchi turi</span>
                      <p>{r.participant_kind === 'employee' ? 'Xodim' : 'Talaba'}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-black/45">Profil (snapshot)</span>
                      <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words bg-white/70 rounded-lg p-2 border border-black/5">
                        {shortJson(r.profile_snapshot, 4000)}
                      </pre>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-black/45">Batafsil tavsif</span>
                      <p className="mt-1 whitespace-pre-wrap text-black/80">{r.description || '—'}</p>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-black/45">AI paket</span>
                      <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words bg-violet-50/80 rounded-lg p-2 border border-violet-100 max-h-96 overflow-y-auto">
                        {shortJson(r.ai_pack, 12000)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
