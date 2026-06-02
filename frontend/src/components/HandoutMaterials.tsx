import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GlobalTopicContext } from '../App';
import {
  deleteHandout,
  fetchHandoutsForTopic,
  isAllowedHandoutFile,
  resolveHandoutFileUrl,
  type TopicHandoutItem,
  uploadHandout,
} from '../utils/handoutApi';
import { normTopicKey } from '../utils/preparedContentStore';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return '';
  return new Date(d).toLocaleString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type LightboxProps = {
  items: TopicHandoutItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
};

function HandoutLightbox({ items, index, onClose, onIndexChange }: LightboxProps) {
  const item = items[index];
  if (!item) return null;
  const url = resolveHandoutFileUrl(item.file_url);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onClose, onIndexChange]);

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/92"
      role="dialog"
      aria-modal="true"
      aria-label="Tarqatma ko‘rish"
    >
      <header className="flex items-center justify-between px-4 py-3 text-white shrink-0">
        <div className="min-w-0 flex-1 pr-3">
          <p className="text-[15px] font-semibold truncate">{item.title || item.file_name}</p>
          <p className="text-[12px] text-white/60 truncate">
            {index + 1} / {items.length} · {item.author_name || item.owner_key}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20"
          aria-label="Yopish"
        >
          <X size={22} />
        </button>
      </header>

      <div className="flex-1 relative flex items-center justify-center min-h-0 px-2 pb-2">
        {hasPrev && (
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            className="absolute left-2 z-10 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white"
            aria-label="Oldingi"
          >
            <ChevronLeft size={28} />
          </button>
        )}

        <div className="w-full h-full max-w-6xl flex items-center justify-center">
          {item.kind === 'pdf' ? (
            <iframe
              title={item.file_name}
              src={url}
              className="w-full h-full min-h-[50vh] rounded-lg bg-white"
            />
          ) : (
            <img
              src={url}
              alt={item.title || item.file_name}
              className="max-w-full max-h-[calc(100dvh-8rem)] object-contain rounded-lg shadow-2xl"
            />
          )}
        </div>

        {hasNext && (
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            className="absolute right-2 z-10 p-3 rounded-full bg-white/15 hover:bg-white/25 text-white"
            aria-label="Keyingi"
          >
            <ChevronRight size={28} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function HandoutMaterials() {
  const globalTopic = useContext(GlobalTopicContext);
  const [topic, setTopic] = useState(globalTopic?.title ?? '');
  const [items, setItems] = useState<TopicHandoutItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (globalTopic?.title) setTopic(globalTopic.title);
  }, [globalTopic]);

  const loadHandouts = useCallback(async () => {
    const t = topic.trim();
    if (!t) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await fetchHandoutsForTopic(t);
      setItems(list);
    } catch (e) {
      setItems([]);
      if (e instanceof Error && e.message === 'no-backend-token') {
        setError('Tarqatma materiallar uchun tizimga kirish kerak.');
      } else {
        setError('Tarqatmalarni yuklab bo‘lmadi. Internetni tekshiring.');
      }
    } finally {
      setLoading(false);
    }
  }, [topic]);

  useEffect(() => {
    void loadHandouts();
  }, [loadHandouts]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length || !topic.trim()) return;
    setUploading(true);
    setError(null);
    const files = Array.from(fileList);
    try {
      for (const file of files) {
        if (!isAllowedHandoutFile(file)) {
          setError(`${file.name}: faqat PDF yoki JPG/PNG.`);
          continue;
        }
        await uploadHandout({ topic: topic.trim(), file });
      }
      await loadHandouts();
    } catch {
      setError('Yuklashda xatolik. Fayl hajmi yoki formatni tekshiring.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Ushbu tarqatma materialini o‘chirasizmi?')) return;
    try {
      await deleteHandout(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      setLightboxIndex((idx) => {
        if (idx === null) return null;
        const next = items.filter((x) => x.id !== id);
        if (next.length === 0) return null;
        return Math.min(idx, next.length - 1);
      });
    } catch {
      setError('O‘chirib bo‘lmadi.');
    }
  };

  const topicNorm = normTopicKey(topic);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5 pb-8">
      <div className="ios-glass rounded-[1.5rem] border border-white/70 p-5 sm:p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#083047]">Tarqatma materiallar</h2>
          <p className="text-[14px] text-black/55 mt-1 leading-relaxed">
            Har bir syllabus mavzusiga PDF yoki rasm (JPG) yuklang. Barcha o‘qituvchilar shu mavzuga
            tegishli materiallarni ko‘radi.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[12px] font-semibold text-black/60 ml-1">Syllabus mavzusi</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Mavzu nomi (Syllabusdan tanlangan bo‘lishi mumkin)"
            className="w-full h-11 px-4 bg-white/60 border border-white/70 rounded-xl outline-none focus:bg-white focus:border-amber-400 text-[14px]"
          />
          {globalTopic && normTopicKey(globalTopic.title) === topicNorm && topicNorm && (
            <p className="text-[12px] text-amber-700 font-medium ml-1">
              Tanlangan mavzu: {globalTopic.id} — {globalTopic.title}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button
            type="button"
            disabled={!topic.trim() || uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 text-white text-[14px] font-semibold shadow-md shadow-amber-600/25 hover:bg-amber-500 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            PDF / JPG yuklash
          </button>
          <button
            type="button"
            onClick={() => void loadHandouts()}
            disabled={loading || !topic.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-black/10 bg-white/80 text-[14px] font-semibold text-black/70 hover:bg-white disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            Yangilash
          </button>
        </div>

        {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}
      </div>

      {!topic.trim() ? (
        <p className="text-center text-black/45 py-12">Avval mavzu nomini kiriting yoki Syllabusdan mavzu tanlang.</p>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-amber-600" size={36} />
        </div>
      ) : items.length === 0 ? (
        <p className="text-center text-black/45 py-12 ios-glass rounded-2xl border border-white/60">
          Bu mavzuda hali tarqatma material yo‘q. Birinchi bo‘lib yuklang.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((item, idx) => {
            const url = resolveHandoutFileUrl(item.file_url);
            return (
              <motion.div
                key={item.id}
                layout
                className="group relative ios-glass rounded-2xl border border-white/70 overflow-hidden shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className="block w-full aspect-[4/3] bg-black/5 relative"
                >
                  {item.kind === 'pdf' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-rose-700/80 bg-rose-50/80">
                      <FileText size={40} />
                      <span className="text-[11px] font-bold uppercase tracking-wide">PDF</span>
                    </div>
                  ) : (
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <span className="absolute bottom-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <ZoomIn size={16} />
                  </span>
                </button>
                <div className="p-2.5 space-y-1">
                  <p className="text-[12px] font-semibold text-black/85 line-clamp-2 leading-snug">
                    {item.title || item.file_name}
                  </p>
                  <p className="text-[10px] text-black/45 truncate">{item.author_name}</p>
                  <p className="text-[10px] text-black/35">{formatSize(item.file_size)}</p>
                </div>
                {item.can_delete && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(item.id)}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 text-rose-600 shadow opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="O‘chirish"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {items.length > 0 && (
        <p className="text-center text-[12px] text-black/40">
          Jami {items.length} ta material · {topicNorm}
        </p>
      )}

      <AnimatePresence>
        {lightboxIndex !== null && items[lightboxIndex] && (
          <HandoutLightbox
            items={items}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onIndexChange={setLightboxIndex}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
