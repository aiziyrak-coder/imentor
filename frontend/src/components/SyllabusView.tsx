import React, { useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Loader2, BookOpen, FlaskConical, ArrowRight, Trash2, File, CloudOff } from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, SyllabusTopic } from '../services/aiService';
import { AppLanguageContext } from '../App';
import { localeForLanguage } from '../i18n/language';
import { getBackendAccessToken } from '../utils/backendAuth';
import {
  fetchSyllabusesFromServer,
  upsertSyllabusOnServer,
  deleteSyllabusOnServer,
  type ClientSyllabusDocument,
} from '../utils/syllabusApi';

interface SyllabusViewProps {
  onSelectTopic: (topic: SyllabusTopic) => void;
}

const LOCAL_SYLLABUS_KEY = 'salomatlik-local-syllabuses-v1';

function readLocalSyllabuses(): ClientSyllabusDocument[] {
  try {
    const raw = localStorage.getItem(LOCAL_SYLLABUS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClientSyllabusDocument[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLocalSyllabuses(list: ClientSyllabusDocument[]): void {
  try {
    localStorage.setItem(LOCAL_SYLLABUS_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

export default function SyllabusView({ onSelectTopic }: SyllabusViewProps) {
  const { language } = React.useContext(AppLanguageContext);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [syllabuses, setSyllabuses] = useState<ClientSyllabusDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncLocalOnly, setSyncLocalOnly] = useState(false);

  const mergeAndSort = useCallback((list: ClientSyllabusDocument[]) => {
    return [...list].sort((a, b) => b.createdAt - a.createdAt);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setInitialLoading(true);
      setError(null);
      const local = readLocalSyllabuses();
      const token = await getBackendAccessToken();

      if (!token) {
        if (!cancelled) {
          setSyllabuses(mergeAndSort(local));
          setSyncLocalOnly(true);
          setInitialLoading(false);
        }
        return;
      }

      try {
        let remote = await fetchSyllabusesFromServer();
        if (cancelled) return;

        const known = new Set(remote.map((r) => r.id));
        for (const item of local) {
          if (!known.has(item.id)) {
            try {
              const created = await upsertSyllabusOnServer(item);
              known.add(created.id);
            } catch {
              /* keep trying others */
            }
          }
        }

        remote = await fetchSyllabusesFromServer();
        const merged = mergeAndSort(remote.length > 0 ? remote : local);
        if (!cancelled) {
          setSyllabuses(merged);
          persistLocalSyllabuses(merged);
          setSyncLocalOnly(false);
        }
      } catch {
        if (!cancelled) {
          setSyllabuses(mergeAndSort(local));
          persistLocalSyllabuses(local);
          setSyncLocalOnly(true);
          if (local.length === 0) {
            setError(
              language === 'ru'
                ? 'Не удалось синхронизировать данные с сервером.'
                : language === 'en'
                  ? 'Could not sync syllabuses from the server.'
                  : "Server bilan syllabuslarni sinxronlashda xato. Internetni tekshiring."
            );
          }
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [language, mergeAndSort]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const extractedTopics = await aiService.extractSyllabusTopics(file, language);

      const newItem: ClientSyllabusDocument = {
        id: `local_syl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        topics: extractedTopics,
        createdAt: Date.now(),
      };

      setSyllabuses((prev) => {
        const next = mergeAndSort([newItem, ...prev.filter((s) => s.id !== newItem.id)]);
        persistLocalSyllabuses(next);
        return next;
      });

      const token = await getBackendAccessToken();
      if (token) {
        try {
          const saved = await upsertSyllabusOnServer(newItem);
          setSyllabuses((prev) => {
            const next = mergeAndSort(prev.map((s) => (s.id === newItem.id ? saved : s)));
            persistLocalSyllabuses(next);
            return next;
          });
          setSyncLocalOnly(false);
        } catch {
          setSyncLocalOnly(true);
        }
      } else {
        setSyncLocalOnly(true);
      }
    } catch {
      setError(
        language === 'ru'
          ? 'Ошибка анализа PDF.'
          : language === 'en'
            ? 'Could not analyze the PDF.'
            : "Syllabusni tahlil qilishda xatolik yuz berdi. PDF ni tekshirib qayta urinib ko'ring."
      );
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleDeleteSyllabus = async (doc: ClientSyllabusDocument) => {
    if (!confirm(`Haqiqatan ham "${doc.fileName}" syllabusini o'chirmoqchimisiz?`)) return;
    setError(null);

    setSyllabuses((prev) => {
      const next = prev.filter((s) => s.id !== doc.id);
      persistLocalSyllabuses(next);
      return next;
    });

    const token = await getBackendAccessToken();
    if (!token || doc.serverId == null) return;

    try {
      await deleteSyllabusOnServer(doc.serverId);
    } catch {
      setError(
        language === 'ru'
          ? 'На сервере не удалось удалить запись.'
          : language === 'en'
            ? 'Could not delete on the server (it was removed locally).'
            : "Serverdagi yozuvni o'chirib bo'lmadi (bu qurilmadan olib tashlandi)."
      );
    }
  };

  if (initialLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={48} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 h-full flex flex-col gap-6 md:gap-8 overflow-y-auto">
      {syncLocalOnly && (
        <div className="max-w-6xl mx-auto w-full flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2 text-[12px] text-amber-900">
          <CloudOff size={16} className="shrink-0 mt-0.5" />
          <p>
            {language === 'ru'
              ? 'Нет связи с сервером — данные только на этом устройстве. Войдите в сеть, чтобы синхронизировать.'
              : language === 'en'
                ? 'Not synced to the server — data stays on this device until you are online and logged in.'
                : "Server bilan sinxron yo'q — ma'lumotlar faqat ushbu qurilmada. Boshqa qurilmada ko'rish uchun tarmoq va tizimga kiring."}
          </p>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-6xl mx-auto w-full bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
            {language === 'ru' ? 'Выберите тему' : language === 'en' ? 'Select a topic' : 'Mavzuni tanlang'}
          </h2>
          <p className="text-gray-500 mt-1 text-sm sm:text-base">
            {language === 'ru'
              ? 'Список тем, извлеченных из syllabus. По какой теме провести занятие?'
              : language === 'en'
                ? 'List of topics extracted from the syllabus. Which topic do you want to teach?'
                : "Syllabus tarkibidan ajratib olingan mavzular ro'yxati. Qaysi mavzu bo'yicha mashg'ulot o'tmoqchisiz?"}
          </p>
        </div>
        <div className="shrink-0 w-full sm:w-auto">
          <label
            className={`
            relative inline-flex w-full sm:w-auto items-center justify-center px-4 sm:px-6 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all
            ${loading ? 'border-gray-200 bg-gray-50' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}
          `}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 size={20} className="animate-spin text-blue-500" />
                <span className="font-semibold text-blue-600 text-sm">
                  {language === 'ru' ? 'Чтение...' : language === 'en' ? 'Reading...' : "O'qilmoqda..."}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Upload size={20} className="text-blue-600 shrink-0" />
                <span className="font-semibold text-blue-700 text-sm text-center">
                  {language === 'ru' ? 'Загрузить новый PDF' : language === 'en' ? 'Upload new PDF' : 'Yangi PDF yuklash'}
                </span>
              </div>
            )}
            <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} disabled={loading} />
          </label>
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto w-full">
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium border border-rose-100">{error}</div>
        </div>
      )}

      {syllabuses.length === 0 ? (
        <div className="max-w-xl mx-auto w-full flex flex-col items-center mt-6 sm:mt-10 px-2">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-6 sm:p-10 rounded-[2rem] shadow-xl border border-gray-100 w-full text-center relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-bl-[100px] -z-10" />
            <div className="absolute bottom-0 left-0 w-40 h-40 bg-purple-500/10 rounded-tr-[100px] -z-10" />

            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
              <FileText size={40} className="text-blue-600 sm:w-12 sm:h-12" />
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3 tracking-tight">
              {language === 'ru' ? 'Загрузите syllabus' : language === 'en' ? 'Upload your syllabus' : 'Syllabusni yuklang'}
            </h2>
            <p className="text-gray-500 font-medium leading-relaxed text-sm sm:text-base">
              {language === 'ru'
                ? 'PDF загружается на сервер и синхронизируется между устройствами после входа.'
                : language === 'en'
                  ? 'Upload a PDF once; topics are saved on the server and available on every device.'
                  : "PDF yuklang — mavzular serverda saqlanadi va boshqa telefon/kompyuterdan ham ko'rinadi."}
            </p>
          </motion.div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto w-full space-y-8 sm:space-y-12 pb-4">
          {syllabuses.map((syllabus) => {
            const lectures = syllabus.topics.filter((t) => t.type === 'lecture');
            const practicals = syllabus.topics.filter((t) => t.type === 'practical');

            return (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={syllabus.id}
                className="bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="bg-gray-50/80 px-4 sm:px-6 py-3 sm:py-4 flex items-start sm:items-center justify-between gap-3 border-b border-gray-100">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center text-gray-600 shrink-0">
                      <File size={20} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-800 text-base sm:text-lg break-words">{syllabus.fileName}</h3>
                      <p className="text-xs text-gray-500 font-medium">
                        {language === 'ru' ? 'Загружено: ' : language === 'en' ? 'Uploaded: ' : 'Yuklangan vaqti: '}
                        {new Date(syllabus.createdAt).toLocaleString(localeForLanguage(language))}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteSyllabus(syllabus)}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                    title="Syllabusni o'chirish"
                    type="button"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>

                <div className="p-4 sm:p-6 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 pb-2">
                      <div className="bg-blue-50 text-blue-600 p-1.5 rounded-lg">
                        <BookOpen size={18} />
                      </div>
                      <h4 className="text-lg sm:text-xl font-bold text-gray-800">
                        {language === 'ru' ? 'Лекции' : language === 'en' ? 'Lectures' : "Ma'ruzalar"}
                      </h4>
                    </div>
                    {lectures.length > 0 ? (
                      <div className="grid gap-3">
                        {lectures.map((topic) => (
                          <button
                            key={topic.id}
                            type="button"
                            onClick={() => onSelectTopic(topic)}
                            className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
                          >
                            <div className="w-10 h-11 sm:w-11 sm:h-11 bg-blue-50 text-blue-700 rounded-xl flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                              {topic.id}
                            </div>
                            <div className="flex-1 mt-0.5 min-w-0">
                              <p className="font-medium text-gray-800 text-sm leading-snug group-hover:text-blue-900 break-words">
                                {topic.title}
                              </p>
                            </div>
                            <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500 transition-colors mt-2 shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm italic">
                        {language === 'ru' ? 'Лекции не найдены.' : language === 'en' ? 'No lectures found.' : "Ma'ruzalar topilmadi."}
                      </p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3 pb-2">
                      <div className="bg-indigo-50 text-indigo-600 p-1.5 rounded-lg">
                        <FlaskConical size={18} />
                      </div>
                      <h4 className="text-lg sm:text-xl font-bold text-gray-800">
                        {language === 'ru'
                          ? 'Практические занятия'
                          : language === 'en'
                            ? 'Practical sessions'
                            : "Amaliy Mashg'ulotlar"}
                      </h4>
                    </div>
                    {practicals.length > 0 ? (
                      <div className="grid gap-3">
                        {practicals.map((topic) => (
                          <button
                            key={topic.id}
                            type="button"
                            onClick={() => onSelectTopic(topic)}
                            className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group"
                          >
                            <div className="w-10 h-11 sm:w-11 sm:h-11 bg-indigo-50 text-indigo-700 rounded-xl flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                              {topic.id}
                            </div>
                            <div className="flex-1 mt-0.5 min-w-0">
                              <p className="font-medium text-gray-800 text-sm leading-snug group-hover:text-indigo-900 break-words">
                                {topic.title}
                              </p>
                            </div>
                            <ArrowRight size={18} className="text-gray-300 group-hover:text-indigo-500 transition-colors mt-2 shrink-0" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm italic">
                        {language === 'ru'
                          ? 'Практические занятия не найдены.'
                          : language === 'en'
                            ? 'No practical sessions found.'
                            : "Amaliy mashg'ulotlar topilmadi."}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
