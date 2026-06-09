import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  Loader2,
  MonitorPlay,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GlobalTopicContext, GlobalLectureContext, AppLanguageContext } from '../../App';
import { aiService } from '../../services/aiService';
import type { Slide } from '../../services/presentationTypes';
import {
  enrichPresentationDeck,
  migrateLegacySlide,
  type PresentationPhase,
} from '../../services/presentationEngine';
import {
  deletePreparedContent,
  loadLatestPreparedContent,
  savePreparedContent,
  listPreparedForTopic,
  loadPreparedById,
  type PreparedContentSummary,
} from '../../utils/preparedContentStore';
import {
  addPresentationToArchive,
  loadPresentationArchive,
  removePresentationFromArchive,
  type ArchivedPresentation,
} from '../../utils/presentationArchive';
import ContentTopicToolbar from '../staff/ContentTopicToolbar';
import SlideStage from './SlideStage';
import PresenterMode from './PresenterMode';
import { STUDIO_THEMES, themeById, type StudioThemeId } from './themes';
import { exportDeckToPptx } from './exportDeckPptx';
import { messageFromAiError } from '../../utils/aiErrors';

function normalizeDeck(slides: Slide[], deckTopic: string): Slide[] {
  if (!slides.length) return [];
  return enrichPresentationDeck(slides, deckTopic.trim() || 'Taqdimot');
}

export default function PresentationStudio() {
  const globalTopic = useContext(GlobalTopicContext);
  const { content: lectureText, setContent: setLectureText } = useContext(GlobalLectureContext);
  const { language } = useContext(AppLanguageContext);

  const [topic, setTopic] = useState(globalTopic?.title ?? '');
  const [slideCount, setSlideCount] = useState(14);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [themeId, setThemeId] = useState<StudioThemeId>('aurora');
  const [loading, setLoading] = useState(false);
  const [genPhase, setGenPhase] = useState<PresentationPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archive, setArchive] = useState<ArchivedPresentation[]>(() => loadPresentationArchive());
  const [versions, setVersions] = useState<PreparedContentSummary[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const theme = themeById(themeId);
  const currentSlide = slides[currentIndex];

  useEffect(() => {
    if (globalTopic?.title) setTopic(globalTopic.title);
  }, [globalTopic]);

  const refreshVersions = useCallback(() => {
    if (!topic.trim()) {
      setVersions([]);
      return;
    }
    setVersions(listPreparedForTopic('presentation', topic));
  }, [topic]);

  useEffect(() => {
    refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (!topic.trim()) {
      setSlides([]);
      setCurrentIndex(0);
      setActiveVersionId(null);
      return;
    }
    setSlides([]);
    setCurrentIndex(0);
    setActiveVersionId(null);
    setError(null);
    let mounted = true;
    (async () => {
      const prepared = await loadLatestPreparedContent<{ topic: string; slides: Slide[] }>(
        'presentation',
        topic,
      );
      if (!mounted) return;
      if (prepared?.slides?.length) {
        setSlides(normalizeDeck(prepared.slides, prepared.topic || topic));
        const list = listPreparedForTopic('presentation', topic);
        setActiveVersionId(list[0]?.id ?? null);
      }
      refreshVersions();
    })();
    return () => {
      mounted = false;
    };
  }, [topic, refreshVersions]);

  const persistDeck = useCallback(
    async (deck: Slide[], deckTopic: string) => {
      await savePreparedContent('presentation', deckTopic, { topic: deckTopic, slides: deck });
      addPresentationToArchive(deckTopic, deck);
      setArchive(loadPresentationArchive());
      refreshVersions();
    },
    [refreshVersions],
  );

  const phaseLabel = (p: PresentationPhase | null): string => {
    if (p === 'structure') return 'Tuzilma rejalashtirilmoqda (GPT)…';
    if (p === 'content') return 'Slayd matni va diagrammalar yozilmoqda…';
    if (p === 'images') return 'Rasm promptlari tayyorlanmoqda…';
    if (p === 'done') return 'Yakunlanmoqda…';
    return 'AI taqdimot yaratilmoqda…';
  };

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setGenPhase('structure');
    setError(null);
    try {
      const lec = await loadLatestPreparedContent<{ content: string }>('lecture', topic);
      const ctx = lec?.content?.trim() || '';
      if (ctx) setLectureText(ctx);
      const deck = await aiService.generatePresentation(topic, ctx, slideCount, language, setGenPhase);
      const normalized = normalizeDeck(deck, topic);
      setSlides(normalized);
      setCurrentIndex(0);
      await persistDeck(normalized, topic);
      const list = listPreparedForTopic('presentation', topic);
      setActiveVersionId(list[0]?.id ?? null);
    } catch (err) {
      setError(messageFromAiError(err, 'Taqdimot yaratilmadi. Tarmoqni tekshirib, 1–2 daqiqadan keyin qayta urinib ko‘ring.'));
    } finally {
      setLoading(false);
      setGenPhase(null);
    }
  };

  const handleFromFile = async (file: File) => {
    setLoading(true);
    setGenPhase('structure');
    setError(null);
    try {
      const deck = await aiService.generatePresentationFromFile(file, language, setGenPhase);
      const t = topic || file.name.replace(/\.[^.]+$/, '');
      const normalized = normalizeDeck(deck, t);
      setSlides(normalized);
      setCurrentIndex(0);
      setTopic(t);
      await persistDeck(normalized, t);
    } catch {
      setError('PDF dan taqdimot yaratib bo‘lmadi.');
    } finally {
      setLoading(false);
      setGenPhase(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const updateSlide = (patch: Partial<Slide>) => {
    setSlides((prev) => {
      const next = [...prev];
      next[currentIndex] = { ...next[currentIndex], ...patch };
      return next;
    });
  };

  const addSlide = () => {
    const n: Slide = {
      title: 'Yangi slayd',
      content: ['Asosiy fikr', 'Klinik nuqta'],
      slideKind: 'content',
      layout: 'split',
      visual: {
        type: 'flow',
        steps: [
          { label: '1-bosqich', detail: '' },
          { label: '2-bosqich', detail: '' },
        ],
      },
    };
    setSlides((p) => [...p, migrateLegacySlide(n, p.length, p.length + 1)]);
    setCurrentIndex(slides.length);
  };

  const duplicateSlide = () => {
    if (!currentSlide) return;
    const copy = migrateLegacySlide(
      { ...currentSlide, title: `${currentSlide.title} (nusxa)` },
      slides.length,
      slides.length + 1,
    );
    setSlides((p) => {
      const next = [...p];
      next.splice(currentIndex + 1, 0, copy);
      return next;
    });
    setCurrentIndex(currentIndex + 1);
  };

  const deleteSlide = () => {
    if (slides.length <= 1) return;
    setSlides((p) => p.filter((_, i) => i !== currentIndex));
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const handleSelectVersion = (id: string) => {
    const data = loadPreparedById<{ topic: string; slides: Slide[] }>('presentation', id);
    if (!data?.slides?.length) return;
    setSlides(normalizeDeck(data.slides, data.topic || topic));
    setCurrentIndex(0);
    setActiveVersionId(id);
    setShowArchive(false);
  };

  const handleDeletePresentation = async () => {
    if (!slides.length) return;
    if (!window.confirm('Ushbu taqdimotni o‘chirasizmi? (barcha slaydlar va saqlangan versiya)')) return;
    try {
      const list = listPreparedForTopic('presentation', topic);
      const targetId = activeVersionId || list[0]?.id;
      if (targetId) await deletePreparedContent('presentation', targetId);
      setSlides([]);
      setCurrentIndex(0);
      setActiveVersionId(null);
      refreshVersions();
    } catch {
      setError('Taqdimotni o‘chirib bo‘lmadi.');
    }
  };

  const handleDeleteVersion = async (id: string) => {
    if (!window.confirm('Ushbu saqlangan versiyani o‘chirasizmi?')) return;
    try {
      await deletePreparedContent('presentation', id);
      if (activeVersionId === id) {
        setSlides([]);
        setCurrentIndex(0);
        setActiveVersionId(null);
      }
      refreshVersions();
      const remaining = listPreparedForTopic('presentation', topic);
      if (remaining[0] && activeVersionId === id) {
        handleSelectVersion(remaining[0].id);
      }
    } catch {
      setError('Versiyani o‘chirib bo‘lmadi.');
    }
  };

  if (showArchive) {
    return (
      <div className="h-full p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto ios-glass rounded-3xl border border-white/60 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowArchive(false)}
              className="px-3 py-2 rounded-xl bg-white/80 text-sm font-semibold"
            >
              <ChevronLeft size={16} className="inline" /> Studio
            </button>
            <h2 className="text-lg font-bold">Arxiv</h2>
          </div>
          <ul className="space-y-2">
            {archive.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 p-3 rounded-xl bg-white/70 border border-black/5"
              >
                <button
                  type="button"
                  className="flex-1 text-left text-sm font-medium"
                  onClick={() => {
                    setSlides(normalizeDeck(a.slides, a.topic));
                    setTopic(a.topic);
                    setCurrentIndex(0);
                    setShowArchive(false);
                  }}
                >
                  {a.topic}
                  <span className="block text-[11px] text-black/45">
                    {a.slides.length} slayd · {new Date(a.savedAt).toLocaleString('uz-UZ')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    removePresentationFromArchive(a.id);
                    setArchive(loadPresentationArchive());
                  }}
                  className="p-2 text-rose-500"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 bg-[#0a0e1a]/5">
      {presenting && slides.length > 0 && (
        <PresenterMode
          slides={slides}
          index={currentIndex}
          topic={topic}
          theme={theme}
          onIndexChange={setCurrentIndex}
          onClose={() => setPresenting(false)}
        />
      )}

      {/* Top bar */}
      <header className="shrink-0 flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-black/5 bg-white/70 backdrop-blur-xl">
        <div className="flex items-center gap-2 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center text-white shadow-lg">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-slate-900 leading-none">Taqdimot Studio</h1>
            <p className="text-[10px] text-slate-500">OpenAI GPT · PPTXGenJS · Diagrammalar</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STUDIO_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => setThemeId(t.id)}
              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                themeId === t.id ? 'border-slate-900 scale-110' : 'border-white/80'
              }`}
              style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}88)` }}
            />
          ))}
        </div>

        <button
          type="button"
          disabled={!slides.length}
          onClick={() => setPresenting(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[13px] font-semibold disabled:opacity-40"
        >
          <MonitorPlay size={16} /> Namoyish
        </button>
        <button
          type="button"
          disabled={!slides.length}
          onClick={() => void exportDeckToPptx(topic, slides)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold disabled:opacity-40"
        >
          <Download size={16} /> PPTX
        </button>
        <button
          type="button"
          onClick={() => setShowArchive(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold"
        >
          <Archive size={16} />
        </button>
        <button
          type="button"
          disabled={!slides.length}
          onClick={() => void handleDeletePresentation()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-[13px] font-semibold disabled:opacity-40"
        >
          <Trash2 size={16} /> O‘chirish
        </button>
      </header>

      <div className="shrink-0 px-3 sm:px-4 py-3">
        <ContentTopicToolbar
          topic={topic}
          onTopicChange={setTopic}
          topicLabel="Mavzu (Syllabusdan)"
          topicPlaceholder="Avval Syllabusda mavzu tanlang"
          createLabel={loading ? phaseLabel(genPhase) : 'AI taqdimot yaratish'}
          loading={loading}
          onCreate={() => void handleGenerate()}
          accent="indigo"
          versions={versions}
          activeVersionId={activeVersionId}
          onSelectVersion={handleSelectVersion}
          onDeleteVersion={(id) => void handleDeleteVersion(id)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-slate-600">
            Slaydlar:
            <input
              type="range"
              min={8}
              max={24}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
              className="w-24"
            />
            <span className="font-bold text-slate-900">{slideCount}</span>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFromFile(f);
            }}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-700"
          >
            <FileUp size={14} /> PDF dan yaratish
          </button>
        </div>
        {loading && genPhase && (
          <p className="mt-2 text-[13px] text-indigo-700 font-medium animate-pulse">{phaseLabel(genPhase)}</p>
        )}
        {error && <p className="mt-2 text-[13px] text-rose-600 font-medium">{error}</p>}
      </div>

      {slides.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-lg w-full text-center space-y-6 rounded-3xl border border-white/60 bg-gradient-to-br from-white via-indigo-50/50 to-cyan-50/40 p-10 shadow-xl"
          >
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center shadow-2xl shadow-violet-500/30">
              <Wand2 size={36} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Professional taqdimot</h2>
              <p className="text-slate-600 mt-2 text-[15px] leading-relaxed">
                OpenAI GPT tuzilma va matn, Mermaid diagrammalar, statistika, klinik kartalar — bir bosishda. PPTX eksport.
              </p>
            </div>
            <button
              type="button"
              disabled={!topic.trim() || loading}
              onClick={() => void handleGenerate()}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-bold text-[16px] shadow-lg disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin mx-auto" size={24} />
              ) : (
                <>
                  <Sparkles size={20} className="inline mr-2 -mt-0.5" />
                  {slideCount} slayd yaratish
                </>
              )}
            </button>
          </motion.div>
        </div>
      ) : (
        <div className="flex-1 flex min-h-0 gap-2 sm:gap-3 px-2 sm:px-3 pb-3">
          {/* Filmstrip */}
          <aside className="w-16 sm:w-20 shrink-0 flex flex-col gap-1.5 overflow-y-auto scrollbar-hide py-1">
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                  i === currentIndex
                    ? 'border-violet-500 ring-2 ring-violet-300/50 scale-[1.02]'
                    : 'border-slate-200 opacity-70 hover:opacity-100'
                }`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${theme.canvas} scale-[0.25] origin-top-left w-[400%] h-[400%]`}>
                  <div className="p-8">
                    <p className={`text-[48px] font-bold truncate ${theme.titleText}`}>{s.title}</p>
                  </div>
                </div>
                <span className="absolute bottom-0.5 right-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">
                  {i + 1}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={addSlide}
              className="aspect-video rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-violet-400 hover:text-violet-600"
            >
              <Plus size={20} />
            </button>
          </aside>

          {/* Canvas */}
          <main className="flex-1 min-w-0 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 rounded-2xl overflow-hidden shadow-2xl border border-slate-200/80 bg-slate-900">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentIndex}
                  className="w-full h-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {currentSlide && (
                    <SlideStage
                      slide={currentSlide}
                      index={currentIndex}
                      total={slides.length}
                      topic={topic}
                      theme={theme}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="shrink-0 flex items-center justify-center gap-3 py-2">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((i) => i - 1)}
                className="p-2 rounded-xl bg-white border border-slate-200 disabled:opacity-30"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-[13px] font-semibold text-slate-600">
                {currentIndex + 1} / {slides.length}
              </span>
              <button
                type="button"
                disabled={currentIndex >= slides.length - 1}
                onClick={() => setCurrentIndex((i) => i + 1)}
                className="p-2 rounded-xl bg-white border border-slate-200 disabled:opacity-30"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </main>

          {/* Inspector */}
          <aside className="w-56 sm:w-64 shrink-0 hidden lg:flex flex-col gap-3 overflow-y-auto scrollbar-hide py-1">
            {currentSlide && (
              <div className="ios-glass rounded-2xl border border-white/60 p-3 space-y-3 text-[12px]">
                <p className="font-bold text-slate-800 uppercase tracking-wide text-[10px]">Tahrir</p>
                <label className="block space-y-1">
                  <span className="text-slate-500">Sarlavha</span>
                  <input
                    value={currentSlide.title}
                    onChange={(e) => updateSlide({ title: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[13px]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500">Punktlar (har qator)</span>
                  <textarea
                    rows={4}
                    value={(currentSlide.content || []).join('\n')}
                    onChange={(e) =>
                      updateSlide({
                        content: e.target.value.split('\n').filter(Boolean),
                      })
                    }
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[12px] resize-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500">Asosiy xulosa</span>
                  <input
                    value={currentSlide.keyTakeaway ?? ''}
                    onChange={(e) => updateSlide({ keyTakeaway: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[12px]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-slate-500">O‘qituvchi eslatma</span>
                  <textarea
                    rows={3}
                    value={currentSlide.notes ?? ''}
                    onChange={(e) => updateSlide({ notes: e.target.value })}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] resize-none"
                  />
                </label>
                <div className="flex gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={duplicateSlide}
                    className="flex-1 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1"
                  >
                    <Copy size={12} /> Nusxa
                  </button>
                  <button
                    type="button"
                    onClick={deleteSlide}
                    className="py-1.5 px-2 rounded-lg border border-rose-200 text-rose-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void persistDeck(slides, topic)}
                  className="w-full py-2 rounded-xl bg-indigo-600 text-white text-[12px] font-semibold"
                >
                  Saqlash
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
