import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { 
  Presentation, 
  Sparkles, 
  ArrowLeft, 
  Download, 
  Copy, 
  Image as ImageIcon,
  ChevronRight, 
  ChevronLeft,
  Loader2,
  AlertCircle,
  Wand2,
  Palette,
  Upload,
  X,
  FileText,
  LayoutTemplate,
  Type,
  Plus,
  ImagePlus,
  Maximize,
  Archive,
  Save,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { aiService, Slide } from '../services/aiService';
import { GlobalTopicContext, GlobalLectureContext } from '../App';
import {
  loadPresentationArchive,
  addPresentationToArchive,
  removePresentationFromArchive,
  type ArchivedPresentation,
} from '../utils/presentationArchive';
import { loadLatestPreparedContent, savePreparedContent } from '../utils/preparedContentStore';

export type ThemeId = 'modern-dark' | 'clinical-light' | 'ocean-blue' | 'minimal-glass';

export type SlideLayout = 'standard' | 'split' | 'title' | 'image-focus';

interface Theme {
  id: ThemeId;
  name: string;
  bgClass: string;
  textClass: string;
  textMutedClass: string;
  gradient1: string;
  gradient2: string;
  bulletClass: string;
  badgeClass: string;
}

const TEMPLATES = [
  { id: 'standard', name: "Standart", icon: <FileText size={16}/> },
  { id: 'title', name: "Sarlavha", icon: <Type size={16}/> },
];

const THEMES: Theme[] = [
  {
    id: 'modern-dark',
    name: "Tungi",
    bgClass: "bg-[#1c1c1e] text-white border-white/10",
    textClass: "text-white/90",
    textMutedClass: "text-white/70",
    gradient1: "from-blue-500/20",
    gradient2: "from-purple-500/10",
    bulletClass: "bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.8)]",
    badgeClass: "bg-white/10 border-white/20 text-blue-300"
  },
  {
    id: 'clinical-light',
    name: "Klinik",
    bgClass: "bg-white text-slate-900 border-slate-200",
    textClass: "text-slate-900",
    textMutedClass: "text-slate-600",
    gradient1: "from-emerald-500/10",
    gradient2: "from-teal-500/10",
    bulletClass: "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]",
    badgeClass: "bg-emerald-50 border-emerald-100 text-emerald-600"
  },
  {
    id: 'ocean-blue',
    name: "Okean",
    bgClass: "bg-sky-900 text-white border-sky-800",
    textClass: "text-white",
    textMutedClass: "text-sky-100",
    gradient1: "from-sky-400/20",
    gradient2: "from-blue-400/20",
    bulletClass: "bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.8)]",
    badgeClass: "bg-white/10 border-white/20 text-sky-100"
  },
  {
    id: 'minimal-glass',
    name: "Oyna",
    bgClass: "bg-slate-50 text-slate-800 border-white/60",
    textClass: "text-slate-800",
    textMutedClass: "text-slate-600",
    gradient1: "from-rose-500/5",
    gradient2: "from-orange-500/5",
    bulletClass: "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]",
    badgeClass: "bg-white/60 border-white text-rose-600"
  }
];

export default function PresentationBuilder() {
  const globalTopic = useContext(GlobalTopicContext);
  const globalLectureCtx = useContext(GlobalLectureContext);
  
  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  const lectureText = globalLectureCtx?.content ?? '';
  const setLectureText = globalLectureCtx?.setContent ?? (() => {});

  const [slideCount, setSlideCount] = useState(12);
  const [loading, setLoading] = useState(false);
  const [slides, setSlides] = useState<Slide[]>([]);

  useEffect(() => {
    if (globalTopic) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic]);

  const [archive, setArchive] = useState<ArchivedPresentation[]>(() => loadPresentationArchive());
  const refreshArchive = () => setArchive(loadPresentationArchive());
  const [showArchivePage, setShowArchivePage] = useState(false);

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>('clinical-light');
  const activeTheme = THEMES.find(t => t.id === selectedTheme) || THEMES[0];

  // Presentation Config States
  const [transitionEffect, setTransitionEffect] = useState<'fade' | 'slide' | 'zoom'>('fade');
  const [presenterOpen, setPresenterOpen] = useState(false);
  const presenterRootRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`PRES_${Date.now()}`);

  const closePresenter = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
    setPresenterOpen(false);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setPresenterOpen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!presenterOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void closePresenter();
        return;
      }
      if (e.key === 'ArrowRight') {
        setCurrentSlideIndex((i) => Math.min(i + 1, slides.length - 1));
      }
      if (e.key === 'ArrowLeft') {
        setCurrentSlideIndex((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenterOpen, slides.length, closePresenter]);

  useEffect(() => {
    if (!presenterOpen) return;
    const id = window.setTimeout(() => {
      void presenterRootRef.current?.requestFullscreen?.().catch(() => {});
    }, 80);
    return () => window.clearTimeout(id);
  }, [presenterOpen]);

  // Image Generation States
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isAutoEnrichingVisuals] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [isEditPanelOpen, setIsEditPanelOpen] = useState(false);
  const [notesCopied, setNotesCopied] = useState(false);
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);

  const buildFallbackInfographicDataUrl = useCallback((slide: Slide, slideNo?: number): string => {
    const title = (slide.title || 'Medical Topic').replace(/[<>&"]/g, '');
    const bullets = (slide.content || [])
      .slice(0, 4)
      .map((x, i) => `${i + 1}. ${x}`.replace(/[<>&"]/g, '').slice(0, 72));
    const promptLine = (slide.imagePrompt || 'Infographic fallback')
      .replace(/[<>&"]/g, '')
      .slice(0, 68);
    const lines = bullets
      .map(
        (b, i) =>
          `<g><circle cx="58" cy="${150 + i * 76}" r="7" fill="#3b82f6"/><text x="80" y="${156 + i * 76}" fill="#cbd5e1" font-size="26" font-family="Segoe UI, Arial">${b}</text></g>`
      )
      .join('');
    const badge = slideNo != null ? `Slide ${slideNo}` : 'Medical infographic';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g1)"/>
  <rect x="30" y="30" width="1220" height="660" rx="28" fill="none" stroke="#334155" stroke-width="2"/>
  <text x="56" y="86" fill="#60a5fa" font-size="22" font-family="Segoe UI, Arial" font-weight="700">${badge}</text>
  <text x="56" y="128" fill="#f8fafc" font-size="42" font-family="Segoe UI, Arial" font-weight="700">${title}</text>
  <text x="56" y="684" fill="#94a3b8" font-size="22" font-family="Segoe UI, Arial">Auto-infographic fallback • ${promptLine}</text>
  ${lines}
  <g transform="translate(845 170)">
    <rect x="0" y="0" width="360" height="360" rx="20" fill="#0b1220" stroke="#334155"/>
    <circle cx="180" cy="180" r="122" fill="none" stroke="#60a5fa" stroke-width="8"/>
    <circle cx="180" cy="180" r="88" fill="none" stroke="#22d3ee" stroke-width="6"/>
    <circle cx="180" cy="180" r="52" fill="#2563eb" opacity="0.2"/>
    <line x1="180" y1="58" x2="180" y2="302" stroke="#475569" stroke-width="2"/>
    <line x1="58" y1="180" x2="302" y2="180" stroke="#475569" stroke-width="2"/>
  </g>
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, []);

  const handleLayoutChange = async (layoutId: SlideLayout) => {
    const updatedSlides = [...slides];
    const slide = updatedSlides[currentSlideIndex];
    slide.layout = layoutId;
    setSlides([...updatedSlides]);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const updatedSlides = [...slides];
      updatedSlides[currentSlideIndex].imageUrl = base64String;
      setSlides(updatedSlides);
    };
    reader.readAsDataURL(file);
  };

  const saveCurrentToArchive = () => {
    if (slides.length === 0) return;
    addPresentationToArchive(topic, slides);
    void savePreparedContent('presentation', topic, { topic, slides });
    refreshArchive();
  };

  useEffect(() => {
    if (!topic.trim()) return;
    let mounted = true;
    (async () => {
      const prepared = await loadLatestPreparedContent<{ topic: string; slides: Slide[] }>('presentation', topic);
      if (!mounted || !prepared?.slides?.length) return;
      setSlides(prepared.slides);
      setCurrentSlideIndex(0);
      setError(null);
    })();
    return () => {
      mounted = false;
    };
  }, [topic]);

  useEffect(() => {
    if (!topic.trim() || lectureText.trim()) return;
    let mounted = true;
    (async () => {
      const preparedLecture = await loadLatestPreparedContent<{ topic: string; content: string }>('lecture', topic);
      if (!mounted) return;
      if (preparedLecture?.content?.trim()) {
        setLectureText(preparedLecture.content);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [topic, lectureText, setLectureText]);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await aiService.generatePresentation(topic, lectureText, slideCount);
      setSlides(data);
      setCurrentSlideIndex(0);
      setCustomPrompt('');
      addPresentationToArchive(topic, data);
      await savePreparedContent('presentation', topic, { topic, slides: data });
      refreshArchive();
    } catch (err) {
      setError('Taqdimot yaratishda xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.');
    } finally {
      setLoading(false);
    }
  };

  const loadArchiveEntry = (entry: ArchivedPresentation) => {
    setTopic(entry.topic);
    setSlides(entry.slides.map((s, i) => ({ ...s, layout: i === 0 ? 'title' : 'standard', imageUrl: undefined, imagePrompt: undefined })));
    setCurrentSlideIndex(0);
    setCustomPrompt('');
    setError(null);
  };

  const nextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
      setCustomPrompt(slides[currentSlideIndex + 1].imagePrompt || '');
    }
  };

  const prevSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
      setCustomPrompt(slides[currentSlideIndex - 1].imagePrompt || '');
    }
  };

  const handleGenerateSlideImage = async () => {
    const prompt = customPrompt.trim() || slides[currentSlideIndex].imagePrompt || topic;
    if (!prompt) return;
    
    setIsGeneratingImage(true);
    try {
      const base64Image = await aiService.generateImage(`A professional presentation slide illustration for healthcare/medical topic. ${prompt}. High quality, photorealistic or flat vector design.`);
      if (base64Image) {
        const updatedSlides = [...slides];
        updatedSlides[currentSlideIndex].imageUrl = base64Image;
        setSlides(updatedSlides);
      } else {
        const updatedSlides = [...slides];
        updatedSlides[currentSlideIndex].imageUrl = buildFallbackInfographicDataUrl(
          updatedSlides[currentSlideIndex],
          currentSlideIndex + 1
        );
        setSlides(updatedSlides);
        alert("Rasm servisi javob bermadi. Slayd uchun avtomatik infografika qo'yildi.");
      }
    } catch (err) {
      console.error(err);
      const updatedSlides = [...slides];
      updatedSlides[currentSlideIndex].imageUrl = buildFallbackInfographicDataUrl(
        updatedSlides[currentSlideIndex],
        currentSlideIndex + 1
      );
      setSlides(updatedSlides);
      alert("Rasm yaratishda xatolik. Slayd uchun fallback infografika qo'yildi.");
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedItemIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent, index: number) => {
    if (dragOverIndex === index) {
      setDragOverIndex(null);
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedItemIndex(null);
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(null);
    if (draggedItemIndex === null || draggedItemIndex === index) return;
    
    const newSlides = [...slides];
    const draggedSlide = newSlides[draggedItemIndex];
    newSlides.splice(draggedItemIndex, 1);
    newSlides.splice(index, 0, draggedSlide);
    
    setSlides(newSlides);
    
    if (currentSlideIndex === draggedItemIndex) {
      setCurrentSlideIndex(index);
    } else if (draggedItemIndex < currentSlideIndex && index >= currentSlideIndex) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    } else if (draggedItemIndex > currentSlideIndex && index <= currentSlideIndex) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
    
    setDraggedItemIndex(null);
  };

  const updateSlideTitle = (title: string) => {
    const updatedSlides = [...slides];
    updatedSlides[currentSlideIndex].title = title;
    setSlides(updatedSlides);
  };

  const insertBulletPoint = () => {
    const updatedSlides = [...slides];
    updatedSlides[currentSlideIndex].content.push('Yangi matn kiritish...');
    setSlides(updatedSlides);
    setIsEditPanelOpen(true);
  };

  const insertImagePlaceholder = () => {
    const updatedSlides = [...slides];
    // Avoid overriding if there's already an image
    if (!updatedSlides[currentSlideIndex].imageUrl) {
      updatedSlides[currentSlideIndex].layout = 'split';
      updatedSlides[currentSlideIndex].imagePrompt = 'Yangi rasm yaratish uchun ta\'rif...';
    }
    setSlides(updatedSlides);
    setIsEditPanelOpen(true);
  };

  const updateSlideContent = (contentStr: string) => {
    const updatedSlides = [...slides];
    updatedSlides[currentSlideIndex].content = contentStr.split('\n').filter(s => s.trim() !== '');
    setSlides(updatedSlides);
  };

  const updateSlideNotes = (notes: string) => {
    const updatedSlides = [...slides];
    updatedSlides[currentSlideIndex].notes = notes;
    setSlides(updatedSlides);
  };

  const duplicateCurrentSlide = () => {
    if (!slides[currentSlideIndex]) return;
    const copy: Slide = {
      ...slides[currentSlideIndex],
      title: `${slides[currentSlideIndex].title} (nusxa)`,
    };
    const updated = [...slides];
    updated.splice(currentSlideIndex + 1, 0, copy);
    setSlides(updated);
    setCurrentSlideIndex(currentSlideIndex + 1);
  };

  const deleteCurrentSlide = () => {
    if (slides.length <= 1) return;
    const updated = slides.filter((_, i) => i !== currentSlideIndex);
    setSlides(updated);
    setCurrentSlideIndex((i) => Math.max(0, Math.min(i, updated.length - 1)));
  };

  const copyCurrentSlideNotes = async () => {
    const text = slides[currentSlideIndex]?.notes?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotesCopied(true);
      window.setTimeout(() => setNotesCopied(false), 1300);
    } catch {
      /* ignore clipboard errors */
    }
  };

  const updateSlideImagePrompt = (prompt: string) => {
    const updatedSlides = [...slides];
    updatedSlides[currentSlideIndex].imagePrompt = prompt;
    setSlides(updatedSlides);
    setCustomPrompt(prompt);
  };

  const handleDownloadPPTX = async () => {
    try {
      const { default: PptxGenJS } = await import('pptxgenjs');
      const pres = new PptxGenJS();
      pres.title = topic || "Taqdimot";
      pres.layout = 'LAYOUT_16x9';

      const theme = {
        darkBg: '0F172A',
        lightBg: 'F8FAFC',
        primary: '2563EB',
        secondary: '38BDF8',
        white: 'FFFFFF',
        textDark: '1E293B',
        textLight: '64748B',
        textWhite: 'F1F5F9',
      };

      // 1. Title Master
      pres.defineSlideMaster({
        title: 'MASTER_TITLE',
        background: { color: theme.darkBg },
        objects: [
          // Aesthetic geometric shapes
          { rect: { x: -2, y: 3, w: 5, h: 5, fill: { color: '1E293B' } } },
          { rect: { x: 7.5, y: -2, w: 6, h: 6, fill: { color: theme.primary } } },
          
          { text: { text: 'T A Q D I M O T', options: { x: 0.8, y: 0.8, w: 8, h: 0.5, fontSize: 12, color: theme.secondary, bold: true, align: 'left', fontFace: 'Segoe UI' } } },
          { rect: { x: 0.8, y: 5.0, w: 1.5, h: 0.05, fill: { color: theme.secondary } } },
        ]
      });

      // 2. Standard Master
      pres.defineSlideMaster({
        title: 'MASTER_STANDARD',
        background: { color: theme.white },
        objects: [
          // Modern header bar
          { rect: { x: 0, y: 0, w: '100%', h: 0.8, fill: { color: theme.darkBg } } },
          { rect: { x: 0, y: 0.8, w: '100%', h: 0.05, fill: { color: theme.primary } } },
          // Footer
          { rect: { x: 0, y: '93%', w: '100%', h: '7%', fill: { color: theme.lightBg } } },
          { text: { text: topic || 'Taqdimot', options: { x: 0.5, y: '93.5%', w: 6, h: '5%', fontSize: 10, color: theme.textLight, fontFace: 'Segoe UI' } } },
        ],
        slideNumber: { x: '95%', y: '93.5%', color: theme.textLight, fontSize: 10, fontFace: 'Segoe UI', align: 'right' }
      });

      slides.forEach((slide, index) => {
        const layoutType = slide.layout || (index === 0 ? 'title' : (slide.imageUrl ? 'split' : 'standard'));
        
        let pptxSlide;
        
        if (layoutType === 'title') {
          pptxSlide = pres.addSlide({ masterName: 'MASTER_TITLE' });
          
          pptxSlide.addText(slide.title || 'Taqdimot', {
            x: 0.8, y: 1.8, w: 8, h: 2.0,
            fontSize: 44, bold: true, color: theme.white, align: 'left', fontFace: 'Segoe UI', valign: 'middle', shadow: {type: 'outer', color: '000000', blur: 3, offset: 2, opacity: 0.5}
          });
          
          if (slide.content && slide.content.length > 0) {
            pptxSlide.addText(slide.content[0], {
               x: 0.8, y: 3.8, w: 7, h: 1,
               fontSize: 20, color: theme.textWhite, align: 'left', fontFace: 'Segoe UI', valign: 'top'
            });
          }
        } 
        else if (layoutType === 'split') {
          pptxSlide = pres.addSlide({ masterName: 'MASTER_STANDARD' });
          
          pptxSlide.addText(slide.title || '', {
            x: 0.5, y: 0.1, w: 9, h: 0.6,
            fontSize: 28, bold: true, color: theme.white, fontFace: 'Segoe UI', valign: 'middle'
          });

          if (slide.content && slide.content.length > 0) {
            const formattedContent = slide.content.map(text => ({ 
               text, 
               options: { bullet: { color: theme.primary }, breakLine: true } 
            }));
            pptxSlide.addText(formattedContent, {
              x: 0.5, y: 1.2, w: '45%', h: 3.8,
              fontSize: 18, color: theme.textDark, lineSpacing: 28, fontFace: 'Segoe UI', valign: 'top'
            });
          }

          if (slide.imageUrl) {
             pptxSlide.addImage({
               data: slide.imageUrl.startsWith('data:') ? slide.imageUrl : `data:image/png;base64,${slide.imageUrl}`,
               x: 5.2, y: 1.2, w: 4.3, h: 3.5,
               sizing: { type: 'contain' }
             });
          } else {
             pptxSlide.addShape(pres.ShapeType.rect, {
                x: 5.2, y: 1.2, w: 4.3, h: 3.5, fill: { color: theme.lightBg }
             });
          }
        } 
        else if (layoutType === 'image-focus') {
          pptxSlide = pres.addSlide({ masterName: 'MASTER_STANDARD' });
          
          pptxSlide.addText(slide.title || '', {
            x: 0.5, y: 0.1, w: 9, h: 0.6,
            fontSize: 28, bold: true, color: theme.white, fontFace: 'Segoe UI', valign: 'middle'
          });

          if (slide.imageUrl) {
             pptxSlide.addImage({
               data: slide.imageUrl.startsWith('data:') ? slide.imageUrl : `data:image/png;base64,${slide.imageUrl}`,
               x: 2.0, y: 1.0, w: 6.0, h: 3.0,
               sizing: { type: 'contain' }
             });
          }

          if (slide.content && slide.content.length > 0) {
             const subText = slide.content.join(' • ');
             pptxSlide.addText(subText, {
              x: 1.0, y: 4.2, w: 8.0, h: 0.8,
              fontSize: 16, color: theme.textDark, fontFace: 'Segoe UI', align: 'center', valign: 'top'
            });
          }
        } 
        else {
          pptxSlide = pres.addSlide({ masterName: 'MASTER_STANDARD' });
          
          pptxSlide.addText(slide.title || '', {
            x: 0.5, y: 0.1, w: 9, h: 0.6,
            fontSize: 28, bold: true, color: theme.white, fontFace: 'Segoe UI', valign: 'middle'
          });

          if (slide.content && slide.content.length > 0) {
            const formattedContent = slide.content.map(text => ({ 
               text, 
               options: { bullet: { color: theme.primary }, breakLine: true } 
            }));
            pptxSlide.addText(formattedContent, {
              x: 0.6, y: 1.3, w: 8.8, h: 3.8,
              fontSize: 22, color: theme.textDark, lineSpacing: 34, fontFace: 'Segoe UI', valign: 'top'
            });
          }
        }
      });
      
      await pres.writeFile({ fileName: `${topic || "Taqdimot"}.pptx` });
    } catch (err) {
      console.error('PPTX yuklashda xatolik:', err);
      alert('Taqdimotni yuklab olishda xatolik yuz berdi.');
    }
  };

  return (
    <div className="w-full h-full overflow-hidden">
      {showArchivePage ? (
        <div className="h-full ios-glass rounded-[2rem] border border-slate-200/80 bg-slate-50/40 p-6 sm:p-8 shadow-sm flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowArchivePage(false)}
                className="px-3 py-2 rounded-xl bg-white/70 hover:bg-white text-black/70 text-[13px] font-semibold"
              >
                <ArrowLeft size={14} className="inline mr-1" /> Orqaga
              </button>
              <h3 className="text-[16px] font-bold text-black/90 tracking-tight">Taqdimotlar arxivi</h3>
            </div>
            <span className="text-[11px] font-semibold text-black/35 uppercase tracking-wider">{archive.length} ta</span>
          </div>
          {archive.length === 0 ? (
            <p className="text-[13px] text-black/45 leading-relaxed rounded-xl border border-dashed border-black/10 bg-white/50 px-4 py-6 text-center">
              Hali saqlangan taqdimot yo‘q.
            </p>
          ) : (
            <ul className="space-y-2 overflow-y-auto pr-1 scrollbar-hide">
              {archive.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 bg-white/70 rounded-xl p-3 border border-black/[0.06] shadow-sm hover:border-blue-500/20 transition-colors"
                >
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[13px] font-semibold text-black/85 truncate">{a.topic}</div>
                    <div className="text-[11px] text-black/45 tabular-nums">
                      {new Date(a.savedAt).toLocaleString('uz-UZ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadArchiveEntry(a);
                      setShowArchivePage(false);
                    }}
                    className="shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[12px] font-semibold hover:bg-blue-500"
                  >
                    Ochish
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removePresentationFromArchive(a.id);
                      refreshArchive();
                    }}
                    className="shrink-0 p-2 text-rose-600 hover:bg-rose-500/10 rounded-lg"
                    title="Arxivdan o'chirish"
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
      <div className="space-y-8 h-full overflow-hidden">
      {slides.length === 0 ? (
        <>
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="ios-glass p-6 sm:p-8 lg:p-10 rounded-[2rem] flex flex-col items-center justify-center space-y-5 border border-white/70 shadow-sm"
        >
          <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center text-blue-600 font-bold text-2xl mb-2 backdrop-blur-md shadow-sm">
            <Presentation strokeWidth={2} />
          </div>
          <div className="relative w-full">
            <button
              type="button"
              onClick={() => setShowArchivePage(true)}
              className="absolute right-0 top-0 px-4 py-2 rounded-xl bg-white/70 hover:bg-white text-[13px] font-semibold text-black/70"
            >
              <Archive size={14} className="inline mr-1" /> Arxiv
            </button>
            <h2 className="text-xl font-bold text-black/90 tracking-tight">Yangi taqdimot yaratish</h2>
            <p className="text-[13px] text-black/50 mt-1 font-medium">
              Sohaga oid ma'lumotlar asosida mukammal vizual taqdimot tayyorlash.
            </p>
          </div>

          <div className="w-full max-w-5xl space-y-5 pt-4">
            <div className="flex flex-col text-left space-y-2">
              <label className="text-[12px] font-semibold text-black/60 ml-2">Mavzu yoki sarlavha</label>
              <div className="relative group">
                <input 
                  type="text" 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Masalan: Jamoat salomatligi..." 
                  className="w-full h-12 px-5 bg-white/50 border border-white/60 shadow-sm rounded-2xl outline-none focus:bg-white/80 focus:border-blue-400 transition-all text-[15px] text-black/90 placeholder:text-black/30 placeholder:font-medium"
                />
              </div>
            </div>

            <div className="flex flex-col text-left space-y-2 pt-2">
              <label className="text-[12px] font-semibold text-black/70 ml-2 block leading-snug">
                Taqdimot haqida to&apos;liq ma&apos;lumot (Ixtiyoriy)
              </label>
              <p className="text-[11px] text-black/45 ml-2 leading-relaxed -mt-1">
                Bu yer <strong className="text-black/55 font-semibold">ma&apos;ruza matnidan</strong> olinadi — «Ma&apos;ruza matni» bo&apos;limidagi matn bilan <strong className="text-black/55 font-semibold">bir xil</strong>. Shu maydonda tahrirlasangiz, ma&apos;ruza bo&apos;limi ham yangilanadi (brauzerda saqlanadi).
              </p>
              <div className="relative group">
                <textarea
                  value={lectureText}
                  onChange={(e) => setLectureText(e.target.value)}
                  placeholder="«Ma'ruza matni» bo'limida AI yaratgan yoki o'zingiz yozgan matn shu yerga keladi. Bo'sh bo'lsa, faqat mavzu bo'yicha umumiy taqdimot yaratiladi."
                  className="w-full min-h-[220px] h-56 p-5 bg-white/50 border border-white/60 shadow-sm rounded-2xl outline-none focus:bg-white/80 focus:border-blue-400 transition-all text-[14px] text-black/90 placeholder:text-black/30 placeholder:font-medium resize-y font-[system-ui]"
                />
              </div>
              {!lectureText.trim() && (
                <p className="text-[11px] text-amber-700/90 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 ml-0.5">
                  Hozircha ma&apos;ruza matni topilmadi. Agar oldin yaratgan bo&apos;lsangiz, mavzu nomi bir xil ekanini tekshiring; yoki shu yerga to&apos;g&apos;ridan-to&apos;g&apos;ri matn yozishingiz mumkin.
                </p>
              )}
            </div>

            <div className="pt-2">
               <div className="relative flex items-center justify-center w-full">
                  <div className="border-t border-black/10 w-full"></div>
                  <span className="bg-transparent px-3 text-[12px] font-medium text-black/40 uppercase tracking-widest absolute">yoki</span>
               </div>
            </div>

            <div className="flex flex-col text-left space-y-2">
               <label className="text-[12px] font-semibold text-black/60 ml-2">Fayldan taqdimot yaratish (PDF, PPTX, DOCX)</label>
               <label className="w-full h-12 ios-glass-btn border-dashed border-2 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10 cursor-pointer rounded-2xl flex items-center justify-center gap-2 text-[14px] font-medium text-blue-700 transition-all">
                 <Upload size={18} /> Fayl yuklash
                 <input type="file" accept=".pdf,.pptx,.docx" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setLoading(true);
                    setError(null);
                    try {
                      // Note: We use the aiService to parse the text/structure. PPTX might not be natively supported perfectly, but the intent is handled.
                      const data = await aiService.generatePresentationFromFile(file);
                      setSlides(data);
                      setCurrentSlideIndex(0);
                      setCustomPrompt(data[0]?.imagePrompt || '');
                      const entryTopic = topic || file.name.replace(/\.[^.]+$/, '');
                      addPresentationToArchive(entryTopic, data);
                      await savePreparedContent('presentation', entryTopic, { topic: entryTopic, slides: data });
                      refreshArchive();
                    } catch (err) {
                      setError("Fayldan taqdimot yaratishda xatolik yuz berdi. PDF fayl ishlatib ko'ring.");
                    } finally {
                      setLoading(false);
                    }
                 }} />
               </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] items-end gap-4 pt-4 border-t border-black/10 w-full">
              <div className="text-left min-w-0">
                <label className="text-[12px] font-semibold text-black/60 block mb-3 ml-2">
                  Slaydlar: <span className="bg-black/5 px-2 py-0.5 rounded-md ml-1">{slideCount} ta</span>
                </label>
                <input 
                  type="range" 
                  min="12" 
                  max="30" 
                  value={slideCount}
                  onChange={(e) => setSlideCount(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-black/10 rounded-full appearance-none cursor-pointer border-none outline-none accent-blue-500 hover:accent-blue-400"
                />
              </div>
              <button 
                onClick={handleGenerate}
                disabled={loading || !topic.trim()}
                className="h-12 px-8 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white shadow-lg shadow-blue-600/20 rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-center gap-2 lg:mb-0"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
                Yaratish
              </button>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 text-rose-600 text-[12px] font-semibold bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-500/20 mt-4">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>
        </motion.div>

        
        </>
      ) : (
        <div className="space-y-4 h-full overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ios-glass p-3 rounded-[1.5rem] shadow-sm">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setSlides([])}
                className="px-4 py-2 flex items-center gap-2 text-[13px] font-semibold text-black/50 hover:text-blue-600 transition-colors bg-white/40 hover:bg-white/60 rounded-xl w-fit"
              >
                <ArrowLeft size={16} /> Ortga
              </button>
              <button
                onClick={() => {
                  setSlides([]);
                  setCurrentSlideIndex(0);
                }}
                className="px-4 py-2 flex items-center gap-2 text-[13px] font-semibold text-blue-600 hover:text-blue-700 transition-colors bg-blue-50 hover:bg-blue-100 rounded-xl w-fit"
              >
                <Plus size={16} /> Yangi yaratish
              </button>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] font-medium text-black/40 order-last sm:order-none">
              {sessionIdRef.current}
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPresenterOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md"
              >
                <Maximize size={14} /> Talabalarga (to&apos;liq ekran)
              </button>
              <button
                type="button"
                onClick={saveCurrentToArchive}
                className="ios-glass-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-black/70 hover:bg-white/60"
              >
                <Save size={14} /> Arxivga saqlash
              </button>
              <button
                type="button"
                onClick={() => setShowArchivePage(true)}
                className="ios-glass-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-black/70 hover:bg-white/60"
              >
                <Archive size={14} /> Arxiv
              </button>
              <button 
                onClick={() => setIsEditPanelOpen(!isEditPanelOpen)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all shadow-sm ${isEditPanelOpen ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20 hover:bg-blue-500' : 'ios-glass-btn text-black/70 hover:bg-white/60'}`}
              >
                Tahrirlash
              </button>
              <button
                type="button"
                onClick={duplicateCurrentSlide}
                className="ios-glass-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-black/70 hover:bg-white/70"
                title="Joriy slaydni nusxalash"
              >
                <Copy size={14} /> Slayd nusxasi
              </button>
              <button
                type="button"
                onClick={deleteCurrentSlide}
                disabled={slides.length <= 1}
                className="ios-glass-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                title="Joriy slaydni o'chirish"
              >
                <Trash2 size={14} /> O'chirish
              </button>
              <button 
                onClick={handleDownloadPPTX}
                className="bg-blue-600 text-white flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold hover:bg-blue-500 shadow-md"
              >
                <Download size={14} /> Yuklash
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 items-start relative h-[calc(100%-88px)] overflow-hidden">
            {/* Sidebar Thumbnails */}
            <div className="w-full lg:w-64 shrink-0 space-y-3 print:hidden">
              <div className="text-[12px] font-semibold text-black/50 px-2 uppercase tracking-wider">Mundarija</div>
              <div className="space-y-2 h-[560px] overflow-y-auto pr-2 scrollbar-hide py-1">
                {slides.map((slide, i) => (
                  <button
                    key={i}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDragLeave={(e) => handleDragLeave(e, i)}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    onClick={() => setCurrentSlideIndex(i)}
                    className={`w-full p-4 text-left rounded-2xl transition-all duration-300 cursor-grab active:cursor-grabbing relative
                      ${currentSlideIndex === i 
                        ? 'bg-white shadow-md border-transparent scale-[1.02] z-10' 
                        : 'ios-glass hover:bg-white/60'}
                      ${draggedItemIndex === i ? 'opacity-50 !border-blue-400 !border-dashed' : ''}  
                    `}
                  >
                    {dragOverIndex === i && draggedItemIndex !== null && draggedItemIndex !== i && (
                      <div className={`absolute left-0 right-0 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] z-20 ${draggedItemIndex < i ? '-bottom-1' : '-top-1'}`} />
                    )}
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${currentSlideIndex === i ? 'text-blue-600' : 'text-black/40'}`}>Slayd {i + 1}</span>
                      {currentSlideIndex === i && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />}
                    </div>
                    <h4 className={`text-[13px] font-semibold line-clamp-2 leading-snug ${currentSlideIndex === i ? 'text-black/90' : 'text-black/60'}`}>
                      {slide.title}
                    </h4>
                  </button>
                ))}
                <button
                  onClick={async () => {
                    const newIndex = slides.length;
                    
                    const newSlide: Slide = {
                      title: "Yangi Slayd",
                      content: ["Matn kiriting..."],
                      layout: 'standard'
                    };
                    
                    setSlides(prev => [...prev, newSlide]);
                    setCurrentSlideIndex(newIndex);
                    setIsEditPanelOpen(true);
                    
                    // Auto generate image prompt in background for the new slide
                    setIsGeneratingPrompt(true);
                    try {
                      const generatedPrompt = await aiService.generateImagePrompt(`${topic} - Yangi bo'lim`, ["Tafsilotlar..."]);
                      setSlides(currentSlides => {
                        const updated = [...currentSlides];
                        if (updated[newIndex]) {
                          updated[newIndex].imagePrompt = generatedPrompt;
                        }
                        return updated;
                      });
                    } catch (e) {
                      console.error(e);
                    } finally {
                      setIsGeneratingPrompt(false);
                    }
                  }}
                  className="w-full p-3 text-center rounded-2xl border-2 border-dashed border-black/10 text-black/50 hover:bg-white/40 hover:text-blue-600 hover:border-blue-400/50 transition-all font-semibold flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Yangi Slayd
                </button>
              </div>
            </div>

            {/* Main Slide Viewer */}
            <div className="flex-1 min-w-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-4 overflow-hidden">
              <div className={`${activeTheme.bgClass} transition-colors duration-500 aspect-video rounded-[2rem] p-10 relative overflow-hidden flex flex-col border shadow-2xl xl:col-start-1`}>
                <div className={`absolute top-0 right-0 w-[80%] h-[80%] bg-gradient-to-bl ${activeTheme.gradient1} to-transparent rounded-bl-full blur-3xl pointer-events-none transition-colors duration-500`} />
                <div className={`absolute bottom-0 left-0 w-[60%] h-[60%] bg-gradient-to-tr ${activeTheme.gradient2} to-transparent rounded-tr-full blur-3xl pointer-events-none transition-colors duration-500`} />

                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentSlideIndex}
                    initial={transitionEffect === 'slide' ? { opacity: 0, x: 50 } : transitionEffect === 'zoom' ? { opacity: 0, scale: 0.9, filter: 'blur(10px)' } : { opacity: 0, filter: 'blur(10px)', scale: 0.98 }}
                    animate={transitionEffect === 'slide' ? { opacity: 1, x: 0 } : transitionEffect === 'zoom' ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 1, filter: 'blur(0px)', scale: 1 }}
                    exit={transitionEffect === 'slide' ? { opacity: 0, x: -50 } : transitionEffect === 'zoom' ? { opacity: 0, scale: 1.1, filter: 'blur(10px)' } : { opacity: 0, filter: 'blur(10px)', scale: 1.02 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="relative z-10 flex flex-col h-full group"
                  >
                    {/* Floating Quick Tools */}
                    <div className="absolute top-0 right-0 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-auto">
                       <button onClick={insertBulletPoint} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 hover:bg-blue-600 text-white backdrop-blur text-[12px] font-medium shadow-sm transition-all">
                          <Plus size={14}/> Matn (nuqta) qo'shish
                       </button>
                       
                    </div>

                    <div className="flex items-center gap-4 mb-6">
                      <div className={`px-3 py-1 border rounded-lg text-[12px] font-mono font-medium backdrop-blur-md ${activeTheme.badgeClass} transition-colors duration-500`}>
                        {currentSlideIndex + 1}
                      </div>
                      <span className={`${activeTheme.textMutedClass} opacity-60 font-medium text-[13px] tracking-wide transition-colors duration-500`}>{topic}</span>
                    </div>
                    
                    <div className="flex-1 w-full h-full relative">
                      {/* Standard Layout */}
                      {(slides[currentSlideIndex].layout === 'standard' || (!slides[currentSlideIndex].layout && !slides[currentSlideIndex].imageUrl)) && (
                        <div className="flex flex-col justify-center h-full">
                          <h1 className={`font-bold mb-8 leading-tight tracking-tight ${activeTheme.textClass} transition-colors duration-500 text-3xl md:text-4xl`}>
                            {slides[currentSlideIndex].title}
                          </h1>
                          <ul className="space-y-4">
                            {slides[currentSlideIndex].content.map((point, pi) => (
                              <motion.li 
                                key={pi}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.2 + pi * 0.1, duration: 0.4 }}
                                className={`flex items-start gap-4 ${activeTheme.textMutedClass} font-medium leading-relaxed transition-colors duration-500 text-lg max-w-[85%]`}
                              >
                                <div className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${activeTheme.bulletClass} transition-colors duration-500`} />
                                <span>{point}</span>
                              </motion.li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Split Layout */}
                      {(slides[currentSlideIndex].layout === 'split' || (!slides[currentSlideIndex].layout && slides[currentSlideIndex].imageUrl)) && (
                        <div className="flex gap-8 h-full items-center">
                          <div className="flex-1 flex flex-col justify-center">
                            <h1 className={`font-bold mb-8 leading-tight tracking-tight ${activeTheme.textClass} transition-colors duration-500 text-2xl md:text-3xl`}>
                              {slides[currentSlideIndex].title}
                            </h1>
                            <ul className="space-y-4">
                              {slides[currentSlideIndex].content.map((point, pi) => (
                                <motion.li 
                                  key={pi}
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.2 + pi * 0.1, duration: 0.4 }}
                                  className={`flex items-start gap-4 ${activeTheme.textMutedClass} font-medium leading-relaxed transition-colors duration-500 text-base`}
                                >
                                  <div className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${activeTheme.bulletClass} transition-colors duration-500`} />
                                  <span>{point}</span>
                                </motion.li>
                              ))}
                            </ul>
                          </div>
                          
                          <div className="flex-1 h-full max-h-[360px] rounded-2xl overflow-hidden shadow-2xl border border-black/10 relative bg-black/5 flex items-center justify-center">
                            {slides[currentSlideIndex].imageUrl ? (
                              <motion.img 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                src={slides[currentSlideIndex].imageUrl} 
                                alt="Slide Visual" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.src = buildFallbackInfographicDataUrl(
                                    slides[currentSlideIndex],
                                    currentSlideIndex + 1
                                  );
                                }}
                              />
                            ) : (
                              <div className="text-black/30 flex flex-col items-center">
                                <ImageIcon size={32} className="mb-2 opacity-50"/>
                                <span className="text-[12px] font-medium">Rasm yo'q</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Title Layout */}
                      {slides[currentSlideIndex].layout === 'title' && (
                        <div className="flex flex-col items-center justify-center h-full text-center max-w-3xl mx-auto">
                          <h1 className={`font-bold mb-6 leading-tight tracking-tight ${activeTheme.textClass} transition-colors duration-500 text-4xl md:text-5xl lg:text-6xl`}>
                            {slides[currentSlideIndex].title}
                          </h1>
                          <p className={`text-xl ${activeTheme.textMutedClass} transition-colors duration-500 mt-4 leading-relaxed`}>
                            {slides[currentSlideIndex].content.join(' ')}
                          </p>
                        </div>
                      )}

                      {/* Image Focus Layout */}
                      {slides[currentSlideIndex].layout === 'image-focus' && (
                        <div className="relative w-full h-full rounded-2xl overflow-hidden bg-black/5 group">
                           {slides[currentSlideIndex].imageUrl ? (
                              <img 
                                src={slides[currentSlideIndex].imageUrl} 
                                alt="Slide Visual" 
                                className="absolute inset-0 w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.src = buildFallbackInfographicDataUrl(
                                    slides[currentSlideIndex],
                                    currentSlideIndex + 1
                                  );
                                }}
                              />
                            ) : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center text-black/30">
                                <ImageIcon size={48} className="mb-2 opacity-50"/>
                                <span className="text-[14px] font-medium">Rasm yuklang yoki yarating</span>
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col justify-end p-8">
                               <h1 className="font-bold mb-4 leading-tight tracking-tight text-white text-3xl">
                                {slides[currentSlideIndex].title}
                              </h1>
                              <div className="flex flex-wrap gap-x-6 gap-y-2">
                                {slides[currentSlideIndex].content.map((point, pi) => (
                                  <div key={pi} className="flex items-center gap-2 text-white/90 font-medium text-sm">
                                    <div className="w-1 h-1 rounded-full bg-blue-400" />
                                    <span>{point}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>

                <div className={`absolute bottom-6 left-10 flex items-center gap-3 opacity-40 ${activeTheme.textClass}`}>
                  <img
                    src="/imentor-logo.png"
                    alt="iMentor"
                    className="w-8 h-8 rounded-xl object-cover border border-current/30 bg-white/80"
                  />
                  <div className="text-[11px] font-medium tracking-widest opacity-80">iMentor Platform AI</div>
                </div>
                
                <div className={`absolute bottom-6 right-10 ${activeTheme.textMutedClass} opacity-50 font-medium text-[12px] tracking-widest`}>
                  SLIDE {currentSlideIndex + 1} OF {slides.length}
                </div>
              </div>

              {/* Image & Theme Generator Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4 xl:col-start-2 xl:row-span-2 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto pr-1 scrollbar-hide">
                <div className="ios-glass p-5 rounded-[1.5rem] shadow-sm flex flex-col space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[14px] font-semibold flex items-center gap-2 text-black/80">
                      <FileText size={18} className="text-blue-500" /> O'qituvchi uchun izoh
                    </h3>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={copyCurrentSlideNotes}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                          notesCopied ? 'bg-emerald-100 text-emerald-700' : 'bg-white/70 text-black/60 hover:bg-white'
                        }`}
                      >
                        {notesCopied ? 'Nusxalandi' : 'Nusxa'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsNotesExpanded((v) => !v)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-white/70 text-black/60 hover:bg-white"
                      >
                        {isNotesExpanded ? 'Yig\'ish' : 'Kengaytirish'}
                      </button>
                    </div>
                  </div>
                  <div
                    className={`rounded-xl bg-white/55 border border-white/70 px-4 py-3 text-[13px] text-black/75 leading-relaxed ${
                      isNotesExpanded ? 'min-h-[220px]' : 'min-h-[120px]'
                    }`}
                  >
                    {slides[currentSlideIndex]?.notes?.trim() ||
                      "Bu slayd uchun izoh yo'q. Tahrirlash panelida Notes bo'limiga darsdagi tushuntirish matnini yozing."}
                  </div>
                  <div className="text-[11px] text-black/45 font-medium px-1">
                    Taxminiy tushuntirish vaqti:{" "}
                    {Math.max(
                      1,
                      Math.round(
                        ((slides[currentSlideIndex]?.notes?.trim().split(/\s+/).filter(Boolean).length || 0) || 45) / 120
                      )
                    )}{" "}
                    daqiqa
                  </div>
                </div>

                <div className="ios-glass p-5 rounded-[1.5rem] shadow-sm flex flex-col space-y-3">
                  <h3 className="text-[14px] font-semibold flex items-center gap-2 text-black/80">
                    <Palette size={18} className="text-blue-500" /> Tema Tanlash
                  </h3>
                  <div className="grid grid-cols-1 gap-2 flex-1 overflow-y-auto scrollbar-hide">
                    {THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => setSelectedTheme(theme.id)}
                        className={`relative rounded-xl overflow-hidden p-2.5 border-2 transition-all text-left flex items-center gap-3 ${
                           selectedTheme === theme.id 
                           ? 'border-blue-500 bg-white shadow-sm ring-4 ring-blue-500/10' 
                           : 'border-white/60 bg-white/40 hover:bg-white/60'
                        }`}
                      >
                         <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 shadow-sm text-[9px] font-bold ${theme.bgClass}`}>
                           Aa
                         </div>
                         <span className="text-[12px] font-semibold text-black/80">{theme.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ios-glass p-5 rounded-[1.5rem] shadow-sm flex flex-col space-y-3">
                  <h3 className="text-[14px] font-semibold flex items-center gap-2 text-black/80">
                    <LayoutTemplate size={18} className="text-blue-500" /> Shablonlar
                  </h3>
                  <div className="grid grid-cols-1 gap-2 flex-1 overflow-y-auto scrollbar-hide">
                    {TEMPLATES.map((tpl) => {
                      const currentLayout = slides[currentSlideIndex]?.layout || 'standard';
                      return (
                        <button
                          key={tpl.id}
                          onClick={() => {
                             const updatedSlides = [...slides];
                             updatedSlides[currentSlideIndex].layout = tpl.id as SlideLayout;
                             setSlides(updatedSlides);
                          }}
                          className={`relative rounded-xl overflow-hidden p-2.5 border-2 transition-all text-left flex items-center gap-3 ${
                             currentLayout === tpl.id 
                             ? 'border-blue-500 bg-white shadow-sm ring-4 ring-blue-500/10' 
                             : 'border-white/60 bg-white/40 hover:bg-white/60'
                          }`}
                        >
                           <div className="text-blue-600/70 p-1 bg-blue-500/10 rounded-md">
                             {tpl.icon}
                           </div>
                           <span className="text-[12px] font-semibold text-black/80">{tpl.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Transition State Selector */}
                <div className="ios-glass p-5 rounded-[1.5rem] shadow-sm flex flex-col space-y-3">
                  <h3 className="text-[14px] font-semibold flex items-center gap-2 text-black/80">
                    <Sparkles size={18} className="text-blue-500" /> Effektlar
                  </h3>
                  <div className="grid grid-cols-1 gap-2 flex-1 overflow-y-auto scrollbar-hide">
                    {[
                      { id: 'fade', name: 'Silliq o\'tish (Fade)' },
                      { id: 'slide', name: 'Surilish (Slide)' },
                      { id: 'zoom', name: 'Yaqinlashish (Zoom)' }
                    ].map((effect) => (
                      <button
                        key={effect.id}
                        onClick={() => setTransitionEffect(effect.id as any)}
                        className={`relative rounded-xl overflow-hidden p-2.5 border-2 transition-all text-left flex items-center gap-3 ${
                           transitionEffect === effect.id 
                           ? 'border-blue-500 bg-white shadow-sm ring-4 ring-blue-500/10' 
                           : 'border-white/60 bg-white/40 hover:bg-white/60'
                        }`}
                      >
                         <span className="text-[12px] font-semibold text-black/80">{effect.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between ios-glass p-3 rounded-[1.5rem] shadow-sm xl:col-start-1">
                <button 
                  onClick={prevSlide}
                  disabled={currentSlideIndex === 0}
                  className="px-4 py-3 text-[13px] font-semibold text-black/60 hover:text-black/90 hover:bg-white/50 rounded-xl disabled:opacity-30 disabled:hover:bg-transparent transition-all flex items-center gap-2"
                >
                  <ChevronLeft size={18} /> Avvalgi
                </button>
                
                <div className="flex gap-2">
                  {slides.map((_, i) => (
                    <button 
                      key={i} 
                      onClick={() => setCurrentSlideIndex(i)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${currentSlideIndex === i ? 'w-8 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' : 'w-2 bg-black/10 hover:bg-black/20'}`}
                    />
                  ))}
                </div>
                
                <button 
                  onClick={nextSlide}
                  disabled={currentSlideIndex === slides.length - 1}
                  className="px-4 py-3 text-[13px] font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-500/10 rounded-xl disabled:opacity-30 disabled:hover:bg-transparent transition-all flex items-center gap-2"
                >
                  Keyingi <ChevronRight size={18} />
                </button>
              </div>
              {isAutoEnrichingVisuals && (
                <div className="text-[12px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2 font-medium">
                  AI slaydlarni diagramma/infografika/rasmlar bilan boyitmoqda... (jarayon yakunlanguncha kuting)
                </div>
              )}
            </div>

            {/* Editing Panel */}
            <AnimatePresence>
              {isEditPanelOpen && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 320, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  className="shrink-0 overflow-hidden hidden lg:block"
                >
                  <div className="w-[320px] ios-glass p-5 rounded-[1.5rem] shadow-sm space-y-4 flex flex-col h-full border border-white/60 pb-8">
                    <h3 className="text-[14px] font-semibold text-black/80 flex items-center justify-between pb-3 border-b border-black/5">
                      Slaydni Tahrirlash
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-blue-500/10 text-blue-600 px-2 py-1 rounded-lg"># {currentSlideIndex + 1}</span>
                        <button onClick={() => setIsEditPanelOpen(false)} className="w-6 h-6 flex flex-col items-center justify-center bg-black/5 rounded-full hover:bg-black/10 transition-colors">
                          <X size={14} className="text-black/60"/>
                        </button>
                      </div>
                    </h3>
                    
                    <div className="space-y-5 flex-1 overflow-y-auto min-h-0 pr-1 scrollbar-hide">
                      {/* Layout Edge */}
                      <div className="space-y-2">
                        <label className="text-[12px] font-semibold text-black/60 px-1">Tuzilish (Layout)</label>
                        <div className="grid grid-cols-2 gap-2">
                          {TEMPLATES.map((tpl) => {
                            const currentLayout = slides[currentSlideIndex]?.layout || 'standard';
                            return (
                              <button
                                key={tpl.id}
                                onClick={() => handleLayoutChange(tpl.id as SlideLayout)}
                                className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all border-2 ${
                                  currentLayout === tpl.id 
                                  ? 'border-blue-500 bg-white shadow-sm ring-4 ring-blue-500/10 text-blue-600' 
                                  : 'border-transparent bg-white/40 hover:bg-white/70 text-black/60'
                                }`}
                              >
                                {tpl.icon}
                                <span className="text-[10px] mt-1 font-semibold">{tpl.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Title Edge */}
                      <div className="space-y-2">
                        <label className="text-[12px] font-semibold text-black/60 px-1">Sarlavha</label>
                        <input
                          type="text"
                          value={slides[currentSlideIndex]?.title || ''}
                          onChange={(e) => updateSlideTitle(e.target.value)}
                          className="w-full px-3 py-2 bg-white/50 border border-white/60 shadow-sm rounded-xl outline-none focus:bg-white/80 focus:border-blue-400 transition-all text-[13px] text-black/80 font-medium"
                        />
                      </div>

                      {/* Content Edge */}
                      <div className="space-y-2">
                        <label className="text-[12px] font-semibold text-black/60 px-1">Tarkib (matnlar)</label>
                        <textarea
                          value={slides[currentSlideIndex]?.content.join('\n') || ''}
                          onChange={(e) => updateSlideContent(e.target.value)}
                          className="w-full h-32 px-3 py-2 bg-white/50 border border-white/60 shadow-sm rounded-xl outline-none focus:bg-white/80 focus:border-blue-400 transition-all text-[13px] text-black/80 font-medium resize-none leading-relaxed"
                          placeholder="Har bir qator yangi belgi sifatida chiqadi..."
                        />
                      </div>

                      {/* Notes Edge */}
                      <div className="space-y-2 pt-3 border-t border-black/5">
                        <label className="text-[12px] font-semibold text-black/60 px-1">Spiker eslatmalari (Notes)</label>
                        <textarea
                          value={slides[currentSlideIndex]?.notes || ''}
                          onChange={(e) => updateSlideNotes(e.target.value)}
                          className="w-full h-24 px-3 py-2 bg-yellow-50/50 border border-yellow-200/60 shadow-sm rounded-xl outline-none focus:bg-yellow-50 border-yellow-400/50 transition-all text-[13px] text-black/80 font-medium resize-none leading-relaxed"
                          placeholder="Slayd tushuntirishi uchun eslatmalar..."
                        />
                      </div>
                      
                      {/* Image Prompt */}
                      <div className="space-y-2 pt-3 border-t border-black/5">
                        <label className="text-[12px] font-semibold text-black/60 px-1">Rasm Prompti (AI uchun)</label>
                        <textarea
                          value={slides[currentSlideIndex]?.imagePrompt || ''}
                          onChange={(e) => updateSlideImagePrompt(e.target.value)}
                          className="w-full h-16 px-3 py-2 bg-white/50 border border-white/60 shadow-sm rounded-xl outline-none focus:bg-white/80 focus:border-blue-400 transition-all text-[13px] text-black/80 font-medium resize-none leading-relaxed"
                          placeholder="AI rasm xususiyatlari..."
                        />
                      </div>
                      
                      {/* Upload Image Edge */}
                      <div className="space-y-2 pt-3 border-t border-black/5">
                        <label className="text-[12px] font-semibold text-black/60 px-1">Maxsus Rasm Yuklash</label>
                        <div className="flex gap-2">
                           <label className="flex-1 ios-glass-btn flex items-center justify-center gap-2 py-2 rounded-xl text-[12px] font-semibold text-black/70 cursor-pointer hover:bg-white/60 transition-all">
                             <Upload size={14} /> Shaxsiy yuklash
                             <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                           </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
      </div>
      )}

      {presenterOpen && slides.length > 0 && slides[currentSlideIndex] && (
        <div
          ref={presenterRootRef}
          className="fixed inset-0 z-[400] bg-black flex flex-col items-center justify-center gap-4 p-4 md:p-8"
        >
          <div
            className={`relative w-full max-w-[min(96vw,1440px)] aspect-video rounded-2xl ${activeTheme.bgClass} border shadow-2xl overflow-hidden flex flex-col p-8 md:p-14`}
          >
            <div
              className={`absolute top-0 right-0 w-[80%] h-[80%] bg-gradient-to-bl ${activeTheme.gradient1} to-transparent rounded-bl-full blur-3xl pointer-events-none`}
            />
            <div
              className={`absolute bottom-0 left-0 w-[60%] h-[60%] bg-gradient-to-tr ${activeTheme.gradient2} to-transparent rounded-tr-full blur-3xl pointer-events-none`}
            />
            {(() => {
              const ps = slides[currentSlideIndex];
              const showTitleOnly = ps.layout === 'title';
              const showImageFocus = ps.layout === 'image-focus';
              const showSplit =
                ps.layout === 'split' || (!ps.layout && !!ps.imageUrl);
              const showStandard =
                ps.layout === 'standard' ||
                (!ps.layout && !ps.imageUrl && !showTitleOnly);

              return (
                <div className="relative z-10 flex-1 flex flex-col min-h-0 overflow-auto">
                  {!showTitleOnly && !showImageFocus && (
                    <div className={`flex items-center gap-3 mb-4 ${activeTheme.textMutedClass}`}>
                      <span
                        className={`px-2 py-0.5 rounded-md text-sm font-mono border ${activeTheme.badgeClass}`}
                      >
                        {currentSlideIndex + 1} / {slides.length}
                      </span>
                      <span className="text-sm opacity-70 truncate">{topic}</span>
                    </div>
                  )}

                  {showStandard && (
                    <div className="flex flex-col justify-center flex-1 min-h-0">
                      <h2
                        className={`font-bold mb-6 leading-tight ${activeTheme.textClass} text-3xl md:text-5xl`}
                      >
                        {ps.title}
                      </h2>
                      <ul className="space-y-4 md:space-y-5">
                        {ps.content.map((point, pi) => (
                          <li
                            key={pi}
                            className={`flex items-start gap-4 ${activeTheme.textMutedClass} text-lg md:text-2xl font-medium leading-snug`}
                          >
                            <div
                              className={`mt-2.5 w-2 h-2 rounded-full shrink-0 ${activeTheme.bulletClass}`}
                            />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {showSplit && (
                    <div className="flex flex-col md:flex-row gap-8 flex-1 min-h-0 items-center">
                      <div className="flex-1 flex flex-col justify-center min-w-0">
                        <h2
                          className={`font-bold mb-4 leading-tight ${activeTheme.textClass} text-2xl md:text-4xl`}
                        >
                          {ps.title}
                        </h2>
                        <ul className="space-y-3">
                          {ps.content.map((point, pi) => (
                            <li
                              key={pi}
                              className={`flex items-start gap-3 ${activeTheme.textMutedClass} text-base md:text-xl`}
                            >
                              <div
                                className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${activeTheme.bulletClass}`}
                              />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex-1 w-full max-h-[55vh] md:max-h-none md:h-full min-h-[200px] rounded-2xl overflow-hidden border border-black/10 bg-black/10 flex items-center justify-center">
                        {ps.imageUrl ? (
                          <img
                            src={ps.imageUrl}
                            alt=""
                            className="w-full h-full object-contain"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.src = buildFallbackInfographicDataUrl(
                                ps,
                                currentSlideIndex + 1
                              );
                            }}
                          />
                        ) : (
                          <div className={`${activeTheme.textMutedClass} text-sm p-4 text-center`}>
                            Rasm yo&apos;q — tahrirlash rejimida AI yoki fayl bilan qo&apos;shing
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {showTitleOnly && (
                    <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
                      <h2
                        className={`font-bold leading-tight ${activeTheme.textClass} text-4xl md:text-6xl lg:text-7xl mb-6`}
                      >
                        {ps.title}
                      </h2>
                      <p className={`text-xl md:text-3xl ${activeTheme.textMutedClass} leading-relaxed max-w-4xl`}>
                        {ps.content.join(' ')}
                      </p>
                    </div>
                  )}

                  {showImageFocus && (
                    <div className="relative flex-1 min-h-0 rounded-2xl overflow-hidden bg-black/20">
                      {ps.imageUrl ? (
                        <img
                          src={ps.imageUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = buildFallbackInfographicDataUrl(
                              ps,
                              currentSlideIndex + 1
                            );
                          }}
                        />
                      ) : (
                        <div
                          className={`absolute inset-0 flex items-center justify-center ${activeTheme.textMutedClass}`}
                        >
                          Rasm yo&apos;q
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent flex flex-col justify-end p-6 md:p-10">
                        <h2 className="text-white font-bold text-3xl md:text-5xl mb-4">{ps.title}</h2>
                        <div className="flex flex-wrap gap-x-6 gap-y-2 text-white/95 text-sm md:text-lg">
                          {ps.content.map((point, pi) => (
                            <span key={pi} className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                              {point}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className={`absolute bottom-5 left-8 text-xs md:text-sm opacity-40 ${activeTheme.textClass}`}>
              ← → slaydlar · Esc yopish
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setCurrentSlideIndex((i) => Math.max(0, i - 1))}
              disabled={currentSlideIndex === 0}
              className="px-5 py-2.5 rounded-xl bg-white/10 text-white border border-white/20 text-sm font-semibold hover:bg-white/20 disabled:opacity-30"
            >
              Oldingi
            </button>
            <span className="text-white/80 text-sm font-mono px-2">
              {currentSlideIndex + 1} / {slides.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setCurrentSlideIndex((i) => Math.min(slides.length - 1, i + 1))
              }
              disabled={currentSlideIndex >= slides.length - 1}
              className="px-5 py-2.5 rounded-xl bg-white/10 text-white border border-white/20 text-sm font-semibold hover:bg-white/20 disabled:opacity-30"
            >
              Keyingi
            </button>
            <button
              type="button"
              onClick={() => void closePresenter()}
              className="px-5 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500"
            >
              Yopish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
