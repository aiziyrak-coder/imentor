import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, Trash2, Upload, FileText, ToggleLeft, ToggleRight } from 'lucide-react';
import { aiService } from '../../services/aiService';
import { AppLanguageContext } from '../../App';
import {
  createAdminCourseSyllabus,
  deleteAdminCourseSyllabus,
  fetchAdminCourseSyllabuses,
  updateAdminCourseSyllabus,
  type CourseSyllabusRow,
} from '../../utils/syllabusApi';

export default function AdminSyllabusCatalog() {
  const { language } = React.useContext(AppLanguageContext);
  const [list, setList] = useState<CourseSyllabusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [description, setDescription] = useState('');

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

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = subjectName.trim() || file.name.replace(/\.pdf$/i, '').trim();
    if (!name) {
      setError('Avval fan nomini kiriting.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const topics = await aiService.extractSyllabusTopics(file, language);
      if (!topics.length) throw new Error('empty');
      await createAdminCourseSyllabus({
        subject_name: name,
        description: description.trim(),
        file_name: file.name,
        topics,
        sort_order: list.length,
      });
      setSubjectName('');
      setDescription('');
      await load();
    } catch {
      setError('PDF tahlil qilinmadi yoki saqlanmadi. Fan nomi va faylni tekshiring.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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
      await load();
    } catch {
      setError('O‘chirib bo‘lmadi.');
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
              PDF yuklang — mavzular ajratiladi. O‘qituvchilar fanlarni tanlab oladi.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">Fan nomi *</span>
            <input
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="Masalan: Anatomiya"
              className="w-full h-11 px-3 rounded-xl border border-slate-200"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-semibold text-slate-600">Qisqa tavsif</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ixtiyoriy"
              className="w-full h-11 px-3 rounded-xl border border-slate-200"
            />
          </label>
        </div>

        <label
          className={`flex items-center justify-center gap-2 w-full py-4 rounded-2xl border-2 border-dashed cursor-pointer transition ${
            uploading ? 'border-slate-200 bg-slate-50' : 'border-indigo-300 bg-indigo-50/50 hover:bg-indigo-50'
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin text-indigo-600" size={22} />
              <span className="font-semibold text-indigo-700">PDF tahlil qilinmoqda…</span>
            </>
          ) : (
            <>
              <Upload size={22} className="text-indigo-600" />
              <span className="font-semibold text-indigo-800">Syllabus PDF yuklash</span>
            </>
          )}
          <input type="file" accept=".pdf" className="hidden" disabled={uploading} onChange={(e) => void handlePdfUpload(e)} />
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
          {list.map((row) => (
            <li
              key={row.id}
              className="ios-glass rounded-2xl border border-white/70 p-4 flex flex-wrap items-start gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                <FileText size={20} className="text-slate-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900">{row.subject_name}</p>
                <p className="text-[12px] text-slate-500">
                  {row.topics.length} mavzu · {row.file_name}
                  {row.description ? ` · ${row.description}` : ''}
                </p>
                <p className="text-[11px] text-slate-400 font-mono">{row.subject_code}</p>
              </div>
              <button
                type="button"
                onClick={() => void toggleActive(row)}
                className="flex items-center gap-1 text-[12px] font-semibold text-slate-600"
                title={row.is_active ? 'Faol' : 'Yashirin'}
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
