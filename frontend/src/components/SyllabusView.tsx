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
import { useUiText } from '../i18n/useUiText';
import type { UserRole } from '../utils/localStaffAuth';
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
  userRole: UserRole | null;
  selectedTopic: SyllabusTopicContext | null;
  onSelectTopic: (topic: SyllabusTopicContext) => void;
  onOpenLectures: (topic: SyllabusTopicContext) => void;
  onOpenHandouts: () => void;
}

export default function SyllabusView({
  userRole,
  selectedTopic,
  onSelectTopic,
  onOpenLectures,
  onOpenHandouts,
}: SyllabusViewProps) {
  const { language, setLanguage } = React.useContext(AppLanguageContext);
  const { t } = useUiText();
  const steps = [t('syllabus.step1'), t('syllabus.step2'), t('syllabus.step3')];

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
    if (userRole !== 'hodim') {
      setLoading(false);
      setCatalog([]);
      setMySelections([]);
      setError(t('syllabus.errorRole'));
      return;
    }
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
        setError(t('syllabus.errorLogin'));
      } else if (isSyncUnavailable(err)) {
        setError(t('syllabus.errorRole'));
      } else {
        setError(t('syllabus.errorLoad'));
      }
    } finally {
      setLoading(false);
    }
  }, [userRole, t]);

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
      setError(t('syllabus.errorAdd'));
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
      setError(t('syllabus.errorRemove'));
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
        <p className="text-sm font-medium">{t('syllabus.loading')}</p>
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
              {t('syllabus.title')}
            </h2>
            <p className="text-slate-500 mt-1 text-sm max-w-xl">
              {t('syllabus.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCatalog((v) => !v)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-semibold text-sm shadow-md hover:bg-blue-500 shrink-0"
          >
            <Plus size={18} />
            {showCatalog ? t('syllabus.close') : t('syllabus.addCourse')}
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
            {t('syllabus.availableCourses')}
          </p>
          {catalog.length === 0 ? (
            <p className="text-slate-500 text-sm py-6 text-center">
              {t('syllabus.noCourses')}
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
                      {variants.length} {t('syllabus.tracks')} · {topics} {t('syllabus.topics')}
                    </p>
                    {picked ? (
                      <span className="inline-block mt-2 text-[10px] text-emerald-700 font-bold">
                        ✓ {t('syllabus.selected')}
                      </span>
                    ) : (
                      <span className="inline-block mt-2 text-[10px] text-blue-600 font-semibold">
                        + {t('syllabus.add')}
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
                  {t('syllabus.selectedTopic')}
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
                  {t('syllabus.lectureNotes')}
                </button>
                <button
                  type="button"
                  onClick={onOpenHandouts}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-400 bg-white text-amber-900 text-[13px] font-semibold"
                >
                  {t('syllabus.handouts')}
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
              {t('syllabus.noCourseSelected')}
            </h3>
            <p className="text-gray-500 text-sm">
              {t('syllabus.noCourseHint')}
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
                      {variants.length} {t('syllabus.tracks')} · {totalTopicCount(variants)} {t('syllabus.topics')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === syllabus.id}
                    onClick={() => void removeSubject(syllabus.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 text-[12px] font-semibold"
                  >
                    <X size={16} /> {t('syllabus.remove')}
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
                    title={t('syllabus.lectures')}
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
                    title={t('syllabus.practicals')}
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
  const { t } = useUiText();
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
        <p className="text-gray-400 text-sm italic">{t('syllabus.noTopicsInTrack')}</p>
      )}
    </div>
  );
}
