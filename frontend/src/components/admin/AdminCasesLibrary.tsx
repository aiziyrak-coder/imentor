import React, { useCallback, useMemo, useState } from 'react';
import { BriefcaseMedical, Trash2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  listCaseStudiesLibrary,
  deleteCaseStudyRecord,
  type CaseLibraryRecord,
} from '../../utils/staffContentLibrary';

export default function AdminCasesLibrary() {
  const [tick, setTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    try {
      return listCaseStudiesLibrary();
    } catch {
      return [];
    }
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  const handleDelete = useCallback(
    (id: string) => {
      if (!window.confirm('Bu keys yozuvini bazadan o‘chirishni tasdiqlaysizmi?')) return;
      deleteCaseStudyRecord(id);
      refresh();
      setOpenId(null);
    },
    []
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 px-2 sm:px-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center">
            <BriefcaseMedical size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Keys savollar bazasi</h1>
            <p className="text-[12px] text-black/50">Hodimlar yaratgan keyslar ro‘yxati</p>
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
            Hozircha yozuv yo‘q. Hodimlar «Keys yaratish» orqali materiallar qo‘shadi.
          </div>
        ) : (
          rows.map((row: CaseLibraryRecord) => (
            <div key={row.id} className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId((id) => (id === row.id ? null : row.id))}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-black/[0.02]"
              >
                <div>
                  <p className="font-semibold text-black/90">{row.session.topic}</p>
                  <p className="text-[12px] text-black/45 mt-0.5">
                    {row.authorName} · {new Date(row.createdAt).toLocaleString('uz-UZ')} ·{' '}
                    {row.session.questions.length} ta keys
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(row.id);
                    }}
                    className="p-2 rounded-xl text-rose-600 hover:bg-rose-500/10"
                    title="O‘chirish"
                  >
                    <Trash2 size={18} />
                  </button>
                  {openId === row.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </button>
              <AnimatePresence>
                {openId === row.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-black/5 bg-black/[0.02] px-4 py-3 text-[13px] text-black/80 space-y-4 max-h-[60vh] overflow-y-auto"
                  >
                    {row.session.questions.map((q, i) => (
                      <div key={i} className="space-y-2">
                        <p className="font-semibold text-emerald-800">Keys {i + 1}</p>
                        <p className="whitespace-pre-wrap leading-relaxed">{q.scenario}</p>
                        <p className="text-[12px] text-black/55">
                          <span className="font-semibold">Javob (majmua):</span> {q.answer.slice(0, 500)}
                          {q.answer.length > 500 ? '…' : ''}
                        </p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
