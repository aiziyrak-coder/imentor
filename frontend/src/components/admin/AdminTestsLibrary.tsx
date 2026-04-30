import React, { useCallback, useMemo, useState } from 'react';
import { ClipboardList, Trash2, RefreshCw, Copy, Check } from 'lucide-react';
import { motion } from 'motion/react';
import {
  listTestsLibrary,
  deleteTestRecord,
  type TestLibraryRecord,
} from '../../utils/staffContentLibrary';

export default function AdminTestsLibrary() {
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => {
    try {
      return listTestsLibrary();
    } catch {
      return [];
    }
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  const copyJoin = (sid: string) => {
    const url = `${window.location.origin}${window.location.pathname}?mode=student&sid=${sid}`;
    void navigator.clipboard.writeText(url);
    setCopied(sid);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm('Bu test yozuvini va bog‘liq jonli sessiyani o‘chirishni tasdiqlaysizmi?')) return;
      deleteTestRecord(id);
      refresh();
    },
    []
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 px-2 sm:px-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center">
            <ClipboardList size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Test savollar bazasi</h1>
            <p className="text-[12px] text-black/50">Hodimlar yaratgan testlar va jonli sessiya ID</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-black/10 bg-white text-[13px] font-semibold"
        >
          <RefreshCw size={16} /> Yangilash
        </button>
      </div>

      <div className="space-y-3">
        {rows.length === 0 ? (
          <div className="ios-glass rounded-2xl border p-10 text-center text-black/45 text-[14px]">
            Hozircha yozuv yo‘q. Hodimlar «Test yaratish» orqali bazaga qo‘shadi.
          </div>
        ) : (
          rows.map((row: TestLibraryRecord) => (
            <motion.div
              key={row.id}
              layout
              className="ios-glass rounded-2xl border border-white/60 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-black/90 truncate">{row.testSession.topic}</p>
                <p className="text-[12px] text-black/45 mt-1">
                  {row.authorName} · {new Date(row.createdAt).toLocaleString('uz-UZ')} ·{' '}
                  {row.testSession.questions.length} ta savol
                </p>
                <p className="text-[11px] font-mono text-black/35 mt-1 break-all">
                  Sessiya: {row.liveSessionId}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => copyJoin(row.liveSessionId)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/5 text-[12px] font-semibold text-black/80"
                >
                  {copied === row.liveSessionId ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  Havolani nusxa
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(row.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 text-[12px] font-semibold text-rose-700"
                >
                  <Trash2 size={14} /> O‘chirish
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
