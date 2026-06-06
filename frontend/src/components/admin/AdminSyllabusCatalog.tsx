import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  Upload,
  FileText,
  ToggleLeft,
  ToggleRight,
  FolderOpen,
} from 'lucide-react';
import { aiService } from '../../services/aiService';
import { AppLanguageContext } from '../../App';
import {
  createAdminCourseSyllabus,
  deleteAdminCourseSyllabus,
  fetchAdminCourseSyllabuses,
  updateAdminCourseSyllabus,
  type CourseSyllabusRow,
} from '../../utils/syllabusApi';
import {
  parseVariantLabel,
  resolveSyllabusVariants,
  totalTopicCount,
  type SyllabusVariant,
} from '../../utils/syllabusVariant';

type UploadProgress = {
  current: number;
  total: number;
  fileName: string;
};

export default function AdminSyllabusCatalog() {
  const { language } = React.useContext(AppLanguageContext);
  const [list, setList] = useState<CourseSyllabusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | 'new'>('new');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await fetchAdminCourseSyllabuses());
    } catch {
      setError('Fanlar ro‘yxatini yuklab bo‘lmadi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const existingSubject = useMemo(() => {
    if (selectedSubjectId === 'new') return null;
    return list.find((x) => x.id === selectedSubjectId) ?? null;
  }, [list, selectedSubjectId]);

  useEffect(() => {
    if (existingSubject) {
      setSubjectName(existingSubject.subject_name);
      setDescription(existingSubject.description || '');
    }
  }, [existingSubject?.id]);

  const processFiles = async (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfFiles.length) {
      setError('Kamida bitta PDF tanlang.');
      return;
    }

    setUploading(true);
    setError(null);
    const newVariants: SyllabusVariant[] = [];
    let detectedSubjectName = subjectName.trim() || existingSubject?.subject_name || '';
    let lastFileName = '';

    try {
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        lastFileName = file.name;
        setProgress({ current: i + 1, total: pdfFiles.length, fileName: file.name });
        const extracted = await aiService.extractSyllabusFromPdf(file, language);
        if (!extracted.topics.length) {
          throw new Error(`empty:${file.name}`);
        }
        if (!detectedSubjectName) {
          detectedSubjectName = extracted.subject_name.trim();
          setSubjectName(detectedSubjectName);
        }
        newVariants.push({
          label: parseVariantLabel(file.name),
          file_name: file.name,
          topics: extracted.topics,
        });
      }

      const fanName = subjectName.trim() || detectedSubjectName;
      if (!fanName) {
        setError('PDF dan fan nomi topilmadi. Qo‘lda kiriting yoki boshqa fayl yuklang.');
        return;
      }

      if (existingSubject) {
        await updateAdminCourseSyllabus(existingSubject.id, {
          description: description.trim(),
          variants: newVariants,
          append_variants: true,
        });
      } else {
        await createAdminCourseSyllabus({
          subject_name: fanName,
          description: description.trim(),
          variants: newVariants,
          sort_order: list.length,
        });
        setSubjectName('');
        setDescription('');
        setSelectedSubjectId('new');
      }

      await load();
    } catch {
      setError(
        lastFileName
          ? `"${lastFileName}" tahlil qilinmadi yoki saqlanmadi.`
          : 'PDF tahlil qilinmadi yoki saqlanmadi.',
      );
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await processFiles(files);
    e.target.value = '';
  };

  const toggleActive = async (row: CourseSyllabusRow) => {
    try {
      await updateAdminCourseSyllabus(row.id, { is_active: !row.is_active });
      await load();
    } catch {
      setError('Yangilab bo‘lmadi.');
    }
  };

  const handleDelete = async (row: CourseSyllabusRow) => {
    if (!window.confirm(`"${row.subject_name}" fanini o‘chirasizmi?`)) return;
    try {
      await deleteAdminCourseSyllabus(row.id);
      if (selectedSubjectId === row.id) setSelectedSubjectId('new');
      await load();
    } catch {
      setError('O‘chirib bo‘lmadi.');
    }
  };

  const removeVariant = async (row: CourseSyllabusRow, label: string) => {
    const variants = resolveSyllabusVariants(row).filter((v) => v.label !== label);
    if (!variants.length) {
      setError('Oxirgi PDF ni o‘chirib bo‘lmaydi — butun fanni o‘chiring.');
      return;
    }
    if (!window.confirm(`"${label}" yo'nalishini o‘chirasizmi?`)) return;
    try {
      await updateAdminCourseSyllabus(row.id, { variants });
      await load();
    } catch {
      setError('Yo‘nalishni o‘chirib bo‘lmadi.');
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 h-full overflow-y-auto max-w-5xl mx-auto space-y-6">
      <div className="ios-glass rounded-3xl border border-white/70 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <BookOpen size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Syllabuslar (fan katalogi)</h2>
            <p className="text-[13px] text-slate-500">
              PDF yuklang — AI fan nomi va mavzularni o‘zi ajratadi. Bir nechta PDF: yo'nalish fayl nomidan
              olinadi (masalan: Falsafa (PI).pdf).
            </p>
          </div>
        </div>

        <label className="space-y-1 block">
          <span className="text-[12px] font-semibold text-slate-600">Fan (mavjud yoki yangi)</span>
          <select
            value={selectedSubjectId === 'new' ? 'new' : String(selectedSubjectId)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'new') {
                setSelectedSubjectId('new');
                setSubjectName('');
                setDescription('');
              } else {
                setSelectedSubjectId(Number(v));
              }
            }}
            className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-white"
            disabled={uploading}
          >
            <option value="new">+ Yangi fan</option>
            {list.map((row) => (
              <option key={row.id} value={row.id}>
                {row.subject_name} ({resolveSyllabusVariants(row).length} PDF)
              </option>
            ))}
          </select>
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">Fan nomi (PDF dan avtomatik)</span>
            <input
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="Yuklangach AI to‘ldiradi — kerak bo‘lsa tahrirlang"
              disabled={uploading || (selectedSubjectId !== 'new' && Boolean(existingSubject))}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 disabled:bg-slate-50"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">Qisqa tavsif</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ixtiyoriy"
              disabled={uploading}
              className="w-full h-11 px-3 rounded-xl border border-slate-200"
            />
          </label>
        </div>

        <label
          className={`flex flex-col items-center justify-center gap-2 w-full py-6 rounded-2xl border-2 border-dashed cursor-pointer transition ${
            uploading ? 'border-slate-200 bg-slate-50' : 'border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50'
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin text-indigo-600" size={22} />
              <span className="font-semibold text-indigo-700 text-center px-4">
                {progress
                  ? `${progress.current}/${progress.total}: ${progress.fileName}`
                  : 'PDF tahlil qilinmoqda…'}
              </span>
            </>
          ) : (
            <>
              <FolderOpen size={28} className="text-indigo-600" />
              <span className="font-semibold text-indigo-800">Bir yoki bir nechta PDF yuklash</span>
              <span className="text-[11px] text-indigo-600/80">
                Fan nomi PDF ichidan, yo'nalish fayl nomidan: Falsafa (PI).pdf → PI
              </span>
            </>
          )}
          <input
            type="file"
            accept=".pdf"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => void handlePdfUpload(e)}
          />
        </label>

        {error && <p className="text-[13px] text-rose-600 font-medium">{error}</p>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-indigo-600" size={40} />
        </div>
      ) : list.length === 0 ? (
        <p className="text-center text-slate-500 py-12">Hali fan qo‘shilmagan.</p>
      ) : (
        <ul className="space-y-3">
          {list.map((row) => {
            const variants = resolveSyllabusVariants(row);
            const open = expandedId === row.id;
            return (
              <li key={row.id} className="ios-glass rounded-2xl border border-white/70 overflow-hidden">
                <div className="p-4 flex flex-wrap items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <FileText size={20} className="text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900">{row.subject_name}</p>
                    <p className="text-[12px] text-slate-500">
                      {variants.length} PDF · {totalTopicCount(variants)} mavzu
                      {row.description ? ` · ${row.description}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">{row.subject_code}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : row.id)}
                    className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                    title="PDF ro'yxati"
                  >
                    {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleActive(row)}
                    className="flex items-center gap-1 text-[12px] font-semibold text-slate-600"
                  >
                    {row.is_active ? <ToggleRight className="text-emerald-600" size={22} /> : <ToggleLeft size={22} />}
                    {row.is_active ? 'Faol' : 'O‘chiq'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(row)}
                    className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                {open && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-2">
                    {variants.map((v) => (
                      <div
                        key={`${row.id}-${v.label}-${v.file_name}`}
                        className="flex items-center gap-3 rounded-xl bg-white border border-slate-100 px-3 py-2"
                      >
                        <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
                          {v.label}
                        </span>
                        <span className="text-[12px] text-slate-700 truncate flex-1">{v.file_name}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">{v.topics.length} mavzu</span>
                        <button
                          type="button"
                          onClick={() => void removeVariant(row, v.label)}
                          className="p-1 text-rose-400 hover:text-rose-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSelectedSubjectId(row.id)}
                      className="text-[12px] font-semibold text-indigo-600 hover:underline"
                    >
                      + Bu fanga yana PDF qo‘shish
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
