import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Loader2,
  FlaskConical,
  ArrowRight,
  Check,
  Plus,
  X,
  GraduationCap,
} from 'lucide-react';
import SyllabusHandoutPanel from './staff/SyllabusHandoutPanel';
import { motion } from 'motion/react';
import type { SyllabusTopic } from '../services/aiService';
import { AppLanguageContext } from '../App';
import {
  fetchCourseSyllabusCatalog,
  fetchMyCourseSelections,
  isSyncUnavailable,
  selectCourseSyllabus,
  unselectCourseSyllabus,
  type CourseSyllabusRow,
  type StaffCourseSelectionRow,
} from '../utils/syllabusApi';
import { resolveSyllabusVariants, totalTopicCount } from '../utils/syllabusVariant';

interface SyllabusViewProps {
  selectedTopic: SyllabusTopic | null;
  onSelectTopic: (topic: SyllabusTopic) => void;
  onOpenLectures: (topic: SyllabusTopic) => void;
  onOpenHandouts: () => void;
}

export default function SyllabusView({
  selectedTopic,
  onSelectTopic,
  onOpenLectures,
  onOpenHandouts,
}: SyllabusViewProps) {
  const { language } = React.useContext(AppLanguageContext);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CourseSyllabusRow[]>([]);
  const [mySelections, setMySelections] = useState<StaffCourseSelectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [variantBySubject, setVariantBySubject] = useState<Record<number, string>>({});

  const selectedIds = new Set(mySelections.map((s) => s.syllabus.id));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, mine] = await Promise.all([
        fetchCourseSyllabusCatalog(),
        fetchMyCourseSelections(),
      ]);
      setCatalog(cat);
      setMySelections(mine);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'no-backend-token') {
        setError('Fanlar ro‘yxati uchun tizimga kiring (hodim roli). Chiqing va qayta kiring.');
      } else if (isSyncUnavailable(err)) {
        setError('Fan tanlovi faqat «Hodim» roli uchun. Chiqing va hodim sifatida qayta kiring.');
      } else {
        setError('Ma’lumotlarni yuklab bo‘lmadi. Tizimga kiring va internetni tekshiring.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addSubject = async (row: CourseSyllabusRow) => {
    setBusyId(row.id);
    try {
      await selectCourseSyllabus(row.id);
      await load();
      setShowCatalog(false);
    } catch {
      setError('Fanni qo‘shib bo‘lmadi.');
    } finally {
      setBusyId(null);
    }
  };

  const removeSubject = async (syllabusId: number) => {
    setBusyId(syllabusId);
    try {
      await unselectCourseSyllabus(syllabusId);
      await load();
    } catch {
      setError('Fanni olib tashlab bo‘lmadi.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={48} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 h-full flex flex-col gap-6 overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <GraduationCap className="text-blue-600" size={28} />
              {language === 'ru' ? 'Выберите предмет' : language === 'en' ? 'Select your course' : 'Fanni tanlang'}
            </h2>
            <p className="text-gray-500 mt-1 text-sm">
              {language === 'ru'
                ? 'Сyllabus загружает администратор. Выберите нужные предметы — темы появятся автоматически.'
                : language === 'en'
                  ? 'Admin uploads syllabuses. Pick your courses — topics appear automatically.'
                  : 'Syllabus administrator tomonidan yuklangan. Kerakli fanlarni tanlang — mavzular avtomatik chiqadi.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCatalog((v) => !v)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm shadow-md hover:bg-blue-500"
          >
            <Plus size={18} />
            {showCatalog ? 'Yopish' : 'Fan qo‘shish'}
          </button>
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto w-full bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium border border-rose-100">
          {error}
        </div>
      )}

      {showCatalog && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-6xl mx-auto w-full bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-2"
        >
          <p className="text-[13px] font-bold text-slate-700 mb-2">Mavjud fanlar</p>
          {catalog.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">
              Administrator hali fan qo‘shmagan. Administrator bilan bog‘laning.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {catalog.map((row) => {
                const picked = selectedIds.has(row.id);
                return (
                  <button
                    key={row.id}
                    type="button"
                    disabled={picked || busyId === row.id}
                    onClick={() => void addSubject(row)}
                    className={`text-left p-3 rounded-xl border transition ${
                      picked
                        ? 'border-emerald-300 bg-emerald-50 opacity-60 cursor-default'
                        : 'border-white bg-white hover:border-blue-300 hover:shadow-sm'
                    }`}
                  >
                    <p className="font-semibold text-slate-900 text-sm">{row.subject_name}</p>
                    <p className="text-[11px] text-slate-500">
                      {resolveSyllabusVariants(row).length} yo'nalish · {totalTopicCount(resolveSyllabusVariants(row))} mavzu
                    </p>
                    {picked && <span className="text-[10px] text-emerald-700 font-bold">Tanlangan</span>}
                  </button>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {selectedTopic && (
        <div className="max-w-6xl mx-auto w-full space-y-4">
          <div className="rounded-2xl border-2 border-blue-300 bg-gradient-to-br from-blue-50/90 to-indigo-50/80 p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Tanlangan mavzu</p>
                <p className="text-base sm:text-lg font-bold text-gray-900 mt-0.5">
                  <span className="text-blue-700">{selectedTopic.id}</span> — {selectedTopic.title}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpenLectures(selectedTopic)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[13px] font-semibold"
                >
                  Ma&apos;ruza matni
                </button>
                <button
                  type="button"
                  onClick={onOpenHandouts}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-400 bg-white text-amber-900 text-[13px] font-semibold"
                >
                  Tarqatmalarni ko‘rish
                </button>
              </div>
            </div>
            <SyllabusHandoutPanel topic={selectedTopic} onOpenHandouts={onOpenHandouts} />
          </div>
        </div>
      )}

      {mySelections.length === 0 ? (
        <div className="max-w-xl mx-auto w-full flex flex-col items-center mt-4 px-2 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100 w-full">
            <BookOpen size={48} className="text-blue-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">Fan tanlanmagan</h3>
            <p className="text-gray-500 text-sm">
              «Fan qo‘shish» tugmasini bosing va o‘qitadigan fanlaringizni tanlang.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto w-full space-y-8 pb-4">
          {mySelections.map((sel) => {
            const syllabus = sel.syllabus;
            const variants = resolveSyllabusVariants(syllabus);
            const activeLabel =
              variantBySubject[syllabus.id] ?? variants[0]?.label ?? 'Asosiy';
            const activeVariant =
              variants.find((v) => v.label === activeLabel) ?? variants[0];
            const topics = activeVariant?.topics ?? [];
            const lectures = topics.filter((t) => t.type === 'lecture');
            const practicals = topics.filter((t) => t.type === 'practical');

            return (
              <motion.div
                key={sel.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[1.5rem] border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="bg-gray-50/80 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 border-b border-gray-100">
                  <div>
                    <h3 className="font-bold text-gray-800 text-lg">{syllabus.subject_name}</h3>
                    <p className="text-xs text-gray-500">
                      {variants.length} yo'nalish · {totalTopicCount(variants)} mavzu
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === syllabus.id}
                    onClick={() => void removeSubject(syllabus.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 text-[12px] font-semibold"
                  >
                    <X size={16} /> Olib tashlash
                  </button>
                </div>

                {variants.length > 1 && (
                  <div className="px-4 sm:px-6 py-3 flex flex-wrap gap-2 border-b border-gray-100 bg-white">
                    <span className="text-[11px] font-semibold text-gray-500 self-center mr-1">
                      Yo'nalish:
                    </span>
                    {variants.map((v) => (
                      <button
                        key={v.label}
                        type="button"
                        onClick={() =>
                          setVariantBySubject((prev) => ({ ...prev, [syllabus.id]: v.label }))
                        }
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition ${
                          activeLabel === v.label
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        {v.label}
                        <span className="opacity-70 ml-1">({v.topics.length})</span>
                      </button>
                    ))}
                  </div>
                )}

                {activeVariant && (
                  <p className="px-4 sm:px-6 pt-3 text-[11px] text-gray-400 truncate">
                    {activeVariant.file_name}
                  </p>
                )}

                <div className="p-4 sm:p-6 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <TopicColumn
                    title={language === 'ru' ? 'Лекции' : language === 'en' ? 'Lectures' : "Ma'ruzalar"}
                    icon={<BookOpen size={18} />}
                    iconBg="bg-blue-50 text-blue-600"
                    topics={lectures}
                    selectedTopic={selectedTopic}
                    onSelectTopic={onSelectTopic}
                    accent="blue"
                  />
                  <TopicColumn
                    title={
                      language === 'ru'
                        ? 'Практические'
                        : language === 'en'
                          ? 'Practical'
                          : "Amaliy mashg'ulotlar"
                    }
                    icon={<FlaskConical size={18} />}
                    iconBg="bg-indigo-50 text-indigo-600"
                    topics={practicals}
                    selectedTopic={selectedTopic}
                    onSelectTopic={onSelectTopic}
                    accent="indigo"
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TopicColumn({
  title,
  icon,
  iconBg,
  topics,
  selectedTopic,
  onSelectTopic,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  topics: SyllabusTopic[];
  selectedTopic: SyllabusTopic | null;
  onSelectTopic: (t: SyllabusTopic) => void;
  accent: 'blue' | 'indigo';
}) {
  const selectedCard =
    accent === 'blue'
      ? 'border-2 ring-blue-200 border-blue-500 bg-blue-50/80'
      : 'border-2 ring-indigo-200 border-indigo-500 bg-indigo-50/80';
  const hover =
    accent === 'blue'
      ? 'hover:border-blue-300 hover:bg-blue-50/50'
      : 'hover:border-indigo-300 hover:bg-indigo-50/50';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-2">
        <div className={`p-1.5 rounded-lg ${iconBg}`}>{icon}</div>
        <h4 className="text-lg font-bold text-gray-800">{title}</h4>
      </div>
      {topics.length > 0 ? (
        <div className="grid gap-3">
          {topics.map((topic) => {
            const isSelected =
              selectedTopic?.id === topic.id && selectedTopic?.title === topic.title;
            return (
              <button
                key={`${topic.id}-${topic.title}`}
                type="button"
                onClick={() => onSelectTopic(topic)}
                className={`flex items-start gap-3 p-3 sm:p-4 text-left rounded-2xl border shadow-sm transition-all ${
                  isSelected ? selectedCard : `bg-white border-gray-100 ${hover}`
                }`}
              >
                <div
                  className={`w-10 h-11 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                    isSelected
                      ? accent === 'blue'
                        ? 'bg-blue-600 text-white'
                        : 'bg-indigo-600 text-white'
                      : accent === 'blue'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-indigo-50 text-indigo-700'
                  }`}
                >
                  {topic.id}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-800 text-sm leading-snug break-words">{topic.title}</p>
                </div>
                {isSelected ? (
                  <Check size={20} className={accent === 'blue' ? 'text-blue-600' : 'text-indigo-600'} />
                ) : (
                  <ArrowRight size={18} className="text-gray-300 shrink-0 mt-1" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-gray-400 text-sm italic">Mavzular topilmadi.</p>
      )}
    </div>
  );
}
