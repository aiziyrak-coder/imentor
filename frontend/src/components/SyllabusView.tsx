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
  ChevronLeft,
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
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [activeSyllabusId, setActiveSyllabusId] = useState<number | null>(null);
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
      if (mine.length === 0) setCatalogOpen(true);
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

  useEffect(() => {
    if (selectedTopic?.syllabusId != null) {
      setActiveSyllabusId(selectedTopic.syllabusId);
      return;
    }
    if (mySelections.length === 0) {
      setActiveSyllabusId(null);
      return;
    }
    setActiveSyllabusId((prev) => {
      if (prev != null && mySelections.some((s) => s.syllabus.id === prev)) return prev;
      return mySelections[0].syllabus.id;
    });
  }, [mySelections, selectedTopic?.syllabusId]);

  const syncCourseLanguage = (row: CourseSyllabusRow) => {
    applyInstructionLanguage(resolveSyllabusInstructionLanguage(row), setLanguage);
  };

  const addSubject = async (row: CourseSyllabusRow) => {
    setBusyId(row.id);
    try {
      await selectCourseSyllabus(row.id);
      syncCourseLanguage(row);
      setActiveSyllabusId(row.id);
      setCatalogOpen(false);
      await load();
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

  const activeSelection =
    mySelections.find((s) => s.syllabus.id === activeSyllabusId) ?? mySelections[0] ?? null;
  const activeSyllabus = activeSelection?.syllabus ?? null;
  const activeVariants = activeSyllabus ? resolveSyllabusVariants(activeSyllabus) : [];
  const activeLabel = activeSyllabus
    ? variantBySubject[activeSyllabus.id] ?? activeVariants[0]?.label ?? 'Asosiy'
    : '';
  const activeVariant =
    activeVariants.find((v) => v.label === activeLabel) ?? activeVariants[0];
  const activeTopics = activeVariant?.topics ?? [];
  const activeLectures = activeTopics.filter((topic) => topic.type === 'lecture');
  const activePracticals = activeTopics.filter((topic) => topic.type === 'practical');

  const step1Done = mySelections.length > 0;
  const step2Done = step1Done && activeSyllabus != null;
  const step3Done = selectedTopic != null;

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
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <GraduationCap className="text-blue-600" size={28} />
            {t('syllabus.title')}
          </h2>
          <p className="text-slate-500 mt-1 text-sm max-w-xl">{t('syllabus.subtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {steps.map((label, i) => {
            const done = i === 0 ? step1Done : i === 1 ? step2Done : step3Done;
            const active =
              (i === 0 && !step1Done) ||
              (i === 1 && step1Done && !step2Done) ||
              (i === 2 && step2Done && !step3Done) ||
              (i === 2 && step2Done && step3Done);
            return (
              <span
                key={label}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold ${
                  done
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : active
                      ? 'bg-blue-50 text-blue-800 border border-blue-200'
                      : 'bg-slate-50 text-slate-600 border border-slate-200'
                }`}
              >
                {done ? <Check size={14} /> : <ListChecks size={14} />}
                {label}
                {i < steps.length - 1 && <ChevronRight size={12} className="opacity-40" />}
              </span>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto w-full bg-rose-50 text-rose-700 p-4 rounded-xl text-sm font-medium border border-rose-100">
          {error}
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-5 pb-4">
        {/* 1-bosqich: Fan tanlash */}
        <SyllabusStepSection
          step={1}
          title={t('syllabus.step1')}
          done={step1Done}
          active={!step1Done}
        >
          {mySelections.length > 0 ? (
            <div className="space-y-3">
              <p className="text-[12px] font-semibold text-slate-500">{t('syllabus.myCourses')}</p>
              <div className="flex flex-wrap gap-2">
                {mySelections.map((sel) => {
                  const syllabus = sel.syllabus;
                  const isActive = activeSyllabusId === syllabus.id;
                  return (
                    <div
                      key={sel.id}
                      className={`flex items-center gap-2 pl-4 pr-2 py-2 rounded-xl border transition ${
                        isActive
                          ? 'border-blue-400 bg-blue-50 shadow-sm'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveSyllabusId(syllabus.id)}
                        className="text-left min-w-0"
                      >
                        <p className="font-semibold text-slate-900 text-[13px] truncate max-w-[200px] sm:max-w-none">
                          {syllabus.subject_name}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {instructionLanguageBadge(resolveSyllabusInstructionLanguage(syllabus))}
                        </p>
                      </button>
                      <button
                        type="button"
                        disabled={busyId === syllabus.id}
                        onClick={() => void removeSubject(syllabus.id)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 shrink-0"
                        aria-label={t('syllabus.remove')}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center py-4 px-2">
              <BookOpen size={40} className="text-blue-400 mb-3" />
              <p className="font-semibold text-slate-800">{t('syllabus.noCourseSelected')}</p>
              <p className="text-slate-500 text-sm mt-1 max-w-sm">{t('syllabus.noCourseHint')}</p>
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 mt-3">
            <button
              type="button"
              onClick={() => setCatalogOpen((v) => !v)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-[13px] hover:bg-blue-500"
            >
              <Plus size={16} />
              {catalogOpen ? t('syllabus.close') : t('syllabus.addCourse')}
            </button>
          </div>

          {catalogOpen && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3"
            >
              <p className="text-[13px] font-bold text-slate-700">{t('syllabus.availableCourses')}</p>
              {catalog.length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">{t('syllabus.noCourses')}</p>
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
        </SyllabusStepSection>

        {/* 2-bosqich: Yo'nalish */}
        <SyllabusStepSection
          step={2}
          title={t('syllabus.step2')}
          done={step2Done}
          active={step1Done && !step2Done}
          muted={!step1Done}
        >
          {!step1Done ? (
            <p className="text-sm text-slate-400 italic">{t('syllabus.step2Locked')}</p>
          ) : activeSyllabus ? (
            <div className="space-y-3">
              <p className="text-[13px] font-semibold text-slate-800">{activeSyllabus.subject_name}</p>
              {activeVariants.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {activeVariants.map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => setVariant(activeSyllabus.id, v.label)}
                      className={`px-3 py-2 rounded-xl text-[12px] font-semibold border transition ${
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
              ) : (
                <p className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  {t('syllabus.singleTrack')}: {activeVariants[0]?.label ?? '—'}
                </p>
              )}
              {activeVariant && (
                <p className="text-[11px] text-gray-400 truncate">PDF: {activeVariant.file_name}</p>
              )}
            </div>
          ) : null}
        </SyllabusStepSection>

        {/* 3-bosqich: Mavzu tanlash */}
        <SyllabusStepSection
          step={3}
          title={t('syllabus.step3')}
          done={step3Done}
          active={step2Done && !step3Done}
          muted={!step2Done}
        >
          {!step2Done ? (
            <p className="text-sm text-slate-400 italic">{t('syllabus.step3Locked')}</p>
          ) : activeSyllabus ? (
            <div className="space-y-6">
              {selectedTopic && (
                <div className="rounded-2xl border-2 border-blue-300 bg-gradient-to-br from-blue-50/90 to-indigo-50/80 p-4 sm:p-5 space-y-4">
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
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TopicColumn
                  title={t('syllabus.lectures')}
                  icon={<BookOpen size={18} />}
                  iconBg="bg-blue-50 text-blue-600"
                  topics={activeLectures}
                  selectedTopic={selectedTopic}
                  syllabus={activeSyllabus}
                  variantLabel={activeLabel}
                  onPickTopic={pickTopic}
                  accent="blue"
                />
                <TopicColumn
                  title={t('syllabus.practicals')}
                  icon={<FlaskConical size={18} />}
                  iconBg="bg-indigo-50 text-indigo-600"
                  topics={activePracticals}
                  selectedTopic={selectedTopic}
                  syllabus={activeSyllabus}
                  variantLabel={activeLabel}
                  onPickTopic={pickTopic}
                  accent="indigo"
                />
              </div>
            </div>
          ) : null}
        </SyllabusStepSection>
      </div>
    </div>
  );
}

function SyllabusStepSection({
  step,
  title,
  done,
  active,
  muted,
  children,
}: {
  step: number;
  title: string;
  done: boolean;
  active: boolean;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 sm:p-6 transition-colors ${
        muted
          ? 'border-slate-200 bg-slate-50/60 opacity-80'
          : active
            ? 'border-blue-300 bg-white shadow-md shadow-blue-100/40'
            : done
              ? 'border-emerald-200 bg-white'
              : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-3 mb-4">
        <span
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
            done
              ? 'bg-emerald-500 text-white'
              : active
                ? 'bg-blue-600 text-white'
                : 'bg-slate-200 text-slate-600'
          }`}
        >
          {done ? <Check size={18} /> : step}
        </span>
        <h3 className="text-base sm:text-lg font-bold text-slate-900">{title}</h3>
      </div>
      {children}
    </section>
  );
}

const TOPICS_PER_PAGE = 10;

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
  const [page, setPage] = useState(0);
  const listKey = `${syllabus.id}::${variantLabel}::${accent}`;
  const totalPages = Math.max(1, Math.ceil(topics.length / TOPICS_PER_PAGE));

  useEffect(() => {
    setPage(0);
  }, [listKey]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  useEffect(() => {
    if (!selectedTopic) return;
    const instructionLanguage = resolveSyllabusInstructionLanguage(syllabus);
    const idx = topics.findIndex((topic) =>
      topicsMatch(
        selectedTopic,
        buildTopicContext(topic, syllabus.id, syllabus.subject_name, variantLabel, instructionLanguage),
      ),
    );
    if (idx >= 0) setPage(Math.floor(idx / TOPICS_PER_PAGE));
    // Faqat tanlangan mavzu yoki ro'yxat o'zgarganda — sahifa almashtirishda qayta ishlamasin
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topics listKey bilan birga yangilanadi
  }, [selectedTopic, listKey]);

  const pageStart = page * TOPICS_PER_PAGE;
  const visibleTopics = topics.slice(pageStart, pageStart + TOPICS_PER_PAGE);
  const showPagination = topics.length > TOPICS_PER_PAGE;

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
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-1.5 rounded-lg shrink-0 ${iconBg}`}>{icon}</div>
          <h4 className="text-lg font-bold text-gray-800 truncate">{title}</h4>
        </div>
        {topics.length > 0 && (
          <span className="text-[11px] font-semibold text-gray-400 shrink-0">
            {topics.length} {t('syllabus.topics')}
          </span>
        )}
      </div>
      {topics.length > 0 ? (
        <div className="space-y-3">
        <div className="grid gap-3">
          {visibleTopics.map((topic) => {
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
        {showPagination && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
              {t('common.prev')}
            </button>
            <span className="text-[12px] font-medium text-gray-500 tabular-nums">
              {t('syllabus.topicRange', {
                from: pageStart + 1,
                to: Math.min(pageStart + TOPICS_PER_PAGE, topics.length),
                total: topics.length,
              })}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-gray-200 bg-white text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('common.next')}
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        </div>
      ) : (
        <p className="text-gray-400 text-sm italic">{t('syllabus.noTopicsInTrack')}</p>
      )}
    </div>
  );
}
