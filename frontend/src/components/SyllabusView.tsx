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
  ListChecks,
  ChevronRight,
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
import {
  buildTopicContext,
  loadPersistedVariantBySubject,
  persistVariantBySubject,
  topicsMatch,
  type SyllabusTopicContext,
} from '../utils/syllabusTopicContext';
import {
  applyInstructionLanguage,
  instructionLanguageBadge,
  resolveSyllabusInstructionLanguage,
} from '../utils/syllabusInstructionLanguage';

interface SyllabusViewProps {
  selectedTopic: SyllabusTopicContext | null;
  onSelectTopic: (topic: SyllabusTopicContext) => void;
  onOpenLectures: (topic: SyllabusTopicContext) => void;
  onOpenHandouts: () => void;
}

const STEP_LABELS = {
  uz: ['1. Fan tanlang', '2. Yo‘nalish', '3. Mavzu tanlang'],
  ru: ['1. Выберите предмет', '2. Направление', '3. Выберите тему'],
  en: ['1. Pick course', '2. Track', '3. Pick topic'],
};

export default function SyllabusView({
  selectedTopic,
  onSelectTopic,
  onOpenLectures,
  onOpenHandouts,
}: SyllabusViewProps) {
  const { language, setLanguage } = React.useContext(AppLanguageContext);
  const lang = language === 'ru' || language === 'en' ? language : 'uz';
  const steps = STEP_LABELS[lang];

  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CourseSyllabusRow[]>([]);
  const [mySelections, setMySelections] = useState<StaffCourseSelectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [variantBySubject, setVariantBySubject] = useState<Record<number, string>>(
    () => loadPersistedVariantBySubject(),
  );

  const selectedIds = new Set(mySelections.map((s) => s.syllabus.id));

  const setVariant = useCallback((syllabusId: number, label: string) => {
    setVariantBySubject((prev) => {
      const next = { ...prev, [syllabusId]: label };
      persistVariantBySubject(next);
      return next;
    });
  }, []);

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
      if (mine.length === 0) setShowCatalog(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'no-backend-token') {
        setError('Tizimga qayta kiring (hodim hisobi kerak).');
      } else if (isSyncUnavailable(err)) {
        setError('Bu bo‘lim faqat «Hodim» roli uchun. Hodim sifatida kiring.');
      } else {
        setError('Ma’lumot yuklanmadi. Internetni tekshiring.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncCourseLanguage = (row: CourseSyllabusRow) => {
    applyInstructionLanguage(resolveSyllabusInstructionLanguage(row), setLanguage);
  };

  const addSubject = async (row: CourseSyllabusRow) => {
    setBusyId(row.id);
    try {
      await selectCourseSyllabus(row.id);
      syncCourseLanguage(row);
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

  const pickTopic = (
    topic: SyllabusTopic,
    syllabus: CourseSyllabusRow,
    variantLabel: string,
  ) => {
    const instructionLanguage = resolveSyllabusInstructionLanguage(syllabus);
    applyInstructionLanguage(instructionLanguage, setLanguage);
    onSelectTopic(
      buildTopicContext(topic, syllabus.id, syllabus.subject_name, variantLabel, instructionLanguage),
    );
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 size={40} className="animate-spin text-blue-500" />
        <p className="text-sm font-medium">Fanlar yuklanmoqda…</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 h-full flex flex-col gap-5 overflow-y-auto">
      {/* Sarlavha va qadamlar */}
      <div className="max-w-6xl mx-auto w-full bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <GraduationCap className="text-blue-600" size={28} />
              {lang === 'ru' ? 'Мои предметы' : lang === 'en' ? 'My courses' : 'Mening fanlarim'}
            </h2>
            <p className="text-slate-500 mt-1 text-sm max-w-xl">
              {lang === 'ru'
                ? 'Администратор загрузил syllabus. Выберите предметы, затем тему — откроются лекции и материалы.'
                : lang === 'en'
                  ? 'Admin uploaded syllabuses. Pick your courses, then a topic to unlock lectures and materials.'
                  : 'Administrator fanlar katalogini yuklagan. O‘qitadigan fanlaringizni tanlang, keyin mavzuni bosing — ma’ruza va materiallar ochiladi.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCatalog((v) => !v)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm shadow-md hover:bg-blue-500 shrink-0"
          >
            <Plus size={18} />
            {showCatalog
              ? lang === 'ru'
                ? 'Закрыть'
                : lang === 'en'
                  ? 'Close'
                  : 'Yopish'
              : lang === 'ru'
                ? 'Добавить предмет'
                : lang === 'en'
                  ? 'Add course'
                  : 'Fan qo‘shish'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {steps.map((label, i) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold ${
                i === 0 && mySelections.length > 0
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : i === 2 && selectedTopic
                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                    : 'bg-slate-50 text-slate-600 border border-slate-200'
              }`}
            >
              <ListChecks size={14} />
              {label}
              {i < steps.length - 1 && <ChevronRight size={12} className="opacity-40" />}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto w-full bg-rose-50 text-rose-700 p-4 rounded-xl text-sm font-medium border border-rose-100">
          {error}
        </div>
      )}

      {/* Katalog — fan qo'shish */}
      {showCatalog && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-6xl mx-auto w-full bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3"
        >
          <p className="text-[13px] font-bold text-slate-700">
            {lang === 'ru' ? 'Доступные предметы' : lang === 'en' ? 'Available courses' : 'Mavjud fanlar'}
          </p>
          {catalog.length === 0 ? (
            <p className="text-slate-500 text-sm py-6 text-center">
              {lang === 'ru'
                ? 'Администратор ещё не добавил предметы с темами.'
                : lang === 'en'
                  ? 'Admin has not published any courses with topics yet.'
                  : 'Administrator hali mavzuli fan qo‘shmagan. Administrator bilan bog‘laning.'}
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {catalog.map((row) => {
                const picked = selectedIds.has(row.id);
                const variants = resolveSyllabusVariants(row);
                const topics = totalTopicCount(variants);
                return (
                  <button
                    key={row.id}
                    type="button"
                    disabled={picked || busyId === row.id}
                    onClick={() => void addSubject(row)}
                    className={`text-left p-4 rounded-xl border transition ${
                      picked
                        ? 'border-emerald-300 bg-emerald-50 opacity-70 cursor-default'
                        : 'border-white bg-white hover:border-blue-300 hover:shadow-md'
                    }`}
                  >
                    <p className="font-semibold text-slate-900">{row.subject_name}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {variants.length} yo‘nalish · {topics} mavzu
                    </p>
                    {picked ? (
                      <span className="inline-block mt-2 text-[10px] text-emerald-700 font-bold">
                        ✓ Tanlangan
                      </span>
                    ) : (
                      <span className="inline-block mt-2 text-[10px] text-blue-600 font-semibold">
                        + Qo‘shish
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* Tanlangan mavzu paneli */}
      {selectedTopic && (
        <div className="max-w-6xl mx-auto w-full">
          <div className="rounded-2xl border-2 border-blue-300 bg-gradient-to-br from-blue-50/90 to-indigo-50/80 p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">
                  {lang === 'ru' ? 'Выбранная тема' : lang === 'en' ? 'Selected topic' : 'Tanlangan mavzu'}
                </p>
                <p className="text-[12px] text-blue-800/80 mt-0.5">{selectedTopic.subjectName}</p>
                <p className="text-base sm:text-lg font-bold text-gray-900 mt-1">
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
                  Tarqatma materiallar
                </button>
              </div>
            </div>
            <SyllabusHandoutPanel topic={selectedTopic} onOpenHandouts={onOpenHandouts} />
          </div>
        </div>
      )}

      {/* Fanlar ro'yxati */}
      {mySelections.length === 0 ? (
        <div className="max-w-xl mx-auto w-full flex flex-col items-center mt-2 px-2 text-center">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-100 w-full">
            <BookOpen size={48} className="text-blue-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              {lang === 'ru' ? 'Предмет не выбран' : lang === 'en' ? 'No course selected' : 'Fan tanlanmagan'}
            </h3>
            <p className="text-gray-500 text-sm">
              «Fan qo‘shish» tugmasini bosing va o‘qitadigan fanlaringizni tanlang.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto w-full space-y-6 pb-4">
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
                <div className="bg-slate-50 px-4 sm:px-6 py-4 flex items-center justify-between gap-3 border-b border-gray-100">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2 flex-wrap">
                      {syllabus.subject_name}
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                        {instructionLanguageBadge(resolveSyllabusInstructionLanguage(syllabus))}
                      </span>
                    </h3>
                    <p className="text-xs text-gray-500">
                      {variants.length}{' '}
                      {lang === 'en' ? 'tracks' : lang === 'ru' ? 'направл.' : 'yo‘nalish'} ·{' '}
                      {totalTopicCount(variants)}{' '}
                      {lang === 'en' ? 'topics' : lang === 'ru' ? 'тем' : 'mavzu'}
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
                      {steps[1]}:
                    </span>
                    {variants.map((v) => (
                      <button
                        key={v.label}
                        type="button"
                        onClick={() => setVariant(syllabus.id, v.label)}
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
                    PDF: {activeVariant.file_name}
                  </p>
                )}

                <div className="p-4 sm:p-6 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <TopicColumn
                    title={lang === 'ru' ? 'Лекции' : lang === 'en' ? 'Lectures' : "Ma'ruzalar"}
                    icon={<BookOpen size={18} />}
                    iconBg="bg-blue-50 text-blue-600"
                    topics={lectures}
                    selectedTopic={selectedTopic}
                    syllabus={syllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
                    accent="blue"
                  />
                  <TopicColumn
                    title={
                      lang === 'ru'
                        ? 'Практические'
                        : lang === 'en'
                          ? 'Practical'
                          : "Amaliy mashg'ulotlar"
                    }
                    icon={<FlaskConical size={18} />}
                    iconBg="bg-indigo-50 text-indigo-600"
                    topics={practicals}
                    selectedTopic={selectedTopic}
                    syllabus={syllabus}
                    variantLabel={activeLabel}
                    onPickTopic={pickTopic}
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
  syllabus,
  variantLabel,
  onPickTopic,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  iconBg: string;
  topics: SyllabusTopic[];
  selectedTopic: SyllabusTopicContext | null;
  syllabus: CourseSyllabusRow;
  variantLabel: string;
  onPickTopic: (topic: SyllabusTopic, syllabus: CourseSyllabusRow, variantLabel: string) => void;
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
            const ctx = buildTopicContext(
              topic,
              syllabus.id,
              syllabus.subject_name,
              variantLabel,
              resolveSyllabusInstructionLanguage(syllabus),
            );
            const isSelected = topicsMatch(selectedTopic, ctx);
            return (
              <button
                key={`${syllabus.id}-${variantLabel}-${topic.id}-${topic.title}`}
                type="button"
                onClick={() => onPickTopic(topic, syllabus, variantLabel)}
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
        <p className="text-gray-400 text-sm italic">Bu yo‘nalishda mavzular yo‘q.</p>
      )}
    </div>
  );
}
