import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Files, Loader2, Upload } from 'lucide-react';
import type { SyllabusTopicContext } from '../../utils/syllabusTopicContext';
import {
  fetchHandoutsForTopic,
  HANDOUT_FILE_ACCEPT,
  handoutFileTypeLabel,
  isAllowedHandoutFile,
  uploadHandout,
} from '../../utils/handoutApi';

type Props = {
  topic: SyllabusTopicContext;
  onOpenHandouts: () => void;
};

export default function SyllabusHandoutPanel({ topic, onOpenHandouts }: Props) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshCount = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchHandoutsForTopic(topic);
      setCount(list.length);
      setError(null);
    } catch (e) {
      setCount(0);
      if (e instanceof Error && e.message === 'no-backend-token') {
        setError('Tarqatma yuklash uchun tizimga kiring.');
      }
    } finally {
      setLoading(false);
    }
  }, [topic]);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(fileList)) {
        if (!isAllowedHandoutFile(file)) {
          setError(`${file.name}: faqat PDF yoki rasm (${handoutFileTypeLabel()}).`);
          continue;
        }
        await uploadHandout({ topic, file });
      }
      await refreshCount();
    } catch {
      setError('Yuklashda xatolik. Internet va fayl hajmini tekshiring.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Files size={20} className="text-amber-700 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-amber-950">Tarqatma materiallar</p>
          <p className="text-[12px] text-amber-900/70 leading-snug mt-0.5">
            {handoutFileTypeLabel()} — shu mavzuga yuklanadi. Barcha o‘qituvchilar ko‘ra oladi.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={HANDOUT_FILE_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-500 disabled:opacity-50 shadow-sm"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Yuklash
        </button>
        <button
          type="button"
          onClick={onOpenHandouts}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-300 bg-white text-amber-900 text-[13px] font-semibold hover:bg-amber-50"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Files size={16} />}
          Ko‘rish{count > 0 ? ` (${count})` : ''}
        </button>
      </div>

      {error && <p className="text-[12px] text-rose-600 font-medium">{error}</p>}
      {!loading && count > 0 && !error && (
        <p className="text-[11px] text-amber-800/80">Jami {count} ta material saqlangan.</p>
      )}
    </div>
  );
}
