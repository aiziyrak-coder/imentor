import React, { useState, useRef, useCallback } from 'react';
import {
  Languages,
  Upload,
  Download,
  Loader2,
  ArrowRight,
  FileText,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { pdfjsLib } from '../utils/pdfjsSetup';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { pushAppNotification } from '../utils/notifications';
import { useUiText } from '../i18n/useUiText';
import { languageLabel } from '../i18n/language';
import type { UiTextKey } from '../i18n/translations';
import {
  extractPdfPageText,
  translatePdfPage,
  translatePdfPagesBatch,
  PDF_JPEG_QUALITY,
  PDF_RENDER_SCALE,
  type PageTranslationResult,
  type TranslatedBlock,
} from '../services/translationService';

interface PageData {
  id: number;
  originalImage: string;
  sourceText: string;
  translation?: PageTranslationResult | null;
  translatedError?: string | null;
  isTranslating: boolean;
}

export default function Translator() {
  const { t, language } = useUiText();
  const [pages, setPages] = useState<PageData[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const contentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const abortRef = useRef(0);

  const updatePage = useCallback((pageId: number, patch: Partial<PageData>) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, ...patch } : p)));
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError(t('translator.errorPdfOnly'));
      return;
    }

    setLoadingFile(true);
    setError(null);
    setPages([]);
    setBatchProgress(null);
    abortRef.current += 1;

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      const newPages: PageData[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const pdfPage = await pdf.getPage(i);
        const sourceText = await extractPdfPageText(pdfPage);
        const viewport = pdfPage.getViewport({ scale: PDF_RENDER_SCALE });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPage.render({ canvasContext: context, viewport } as any).promise;

        newPages.push({
          id: i,
          originalImage: canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY),
          sourceText,
          translation: null,
          isTranslating: false,
        });
      }

      setPages(newPages);
    } catch (err) {
      console.error(err);
      setError(t('translator.errorReadPdf'));
    } finally {
      setLoadingFile(false);
      event.target.value = '';
    }
  };

  const applyTranslation = (pageId: number, result: PageTranslationResult) => {
    updatePage(pageId, { isTranslating: false, translation: result, translatedError: null });
  };

  const translateOne = async (pageId: number) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page || page.isTranslating) return;

    updatePage(pageId, { isTranslating: true, translatedError: null, translation: null });
    try {
      const result = await translatePdfPage(page.originalImage, page.sourceText, language);
      applyTranslation(pageId, result);
    } catch (err) {
      console.error('Translation error:', err);
      updatePage(pageId, { isTranslating: false, translatedError: t('translator.errorTranslate') });
    }
  };

  const translateAll = async () => {
    if (!pages.length || batchProgress) return;
    const token = ++abortRef.current;
    const pending = pages.filter((p) => !p.translation && !p.isTranslating);
    if (!pending.length) return;

    setPages((prev) =>
      prev.map((p) =>
        pending.some((x) => x.id === p.id)
          ? { ...p, isTranslating: true, translatedError: null, translation: null }
          : p,
      ),
    );
    setBatchProgress({ done: 0, total: pending.length });

    try {
      const results = await translatePdfPagesBatch(
        pending.map((p) => ({
          id: p.id,
          imageBase64: p.originalImage,
          sourceText: p.sourceText,
        })),
        language,
        (done, total, pageId, result) => {
          if (token !== abortRef.current) return;
          setBatchProgress({ done, total });
          applyTranslation(pageId, result);
        },
      );

      if (token !== abortRef.current) return;

      for (const [pageId, result] of results) {
        applyTranslation(pageId, result);
      }
    } catch (err) {
      console.error(err);
      setError(t('translator.errorTranslate'));
      setPages((prev) => prev.map((p) => ({ ...p, isTranslating: false })));
    } finally {
      if (token === abortRef.current) setBatchProgress(null);
    }
  };

  const generatePDF = async () => {
    if (pages.length === 0) return;
    setGeneratingPDF(true);

    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
      const pdfWidth = pdf.internal.pageSize.getWidth();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (i > 0) pdf.addPage();

        const translatedEl = contentRefs.current[page.id];
        const hasTranslation =
          page.translation &&
          (page.translation.mode === 'text'
            ? page.translation.translatedText
            : page.translation.translatedBlocks.length > 0);

        if (hasTranslation && translatedEl) {
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
          const canvas = await html2canvas(translatedEl, {
            scale: 1.75,
            useCORS: true,
            backgroundColor: '#ffffff',
          });
          const imgData = canvas.toDataURL('image/jpeg', 0.9);
          const ratio = canvas.height / canvas.width;
          pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfWidth * ratio);
          continue;
        }

        pdf.addImage(page.originalImage, 'JPEG', 0, 0, pdfWidth, pdfWidth * (await imageRatio(page.originalImage)));
      }

      pdf.save(t('translator.pdfFilename'));
    } catch (err) {
      console.error('PDF generation error:', err);
      pushAppNotification({
        title: t('translator.errorGeneratePdfTitle'),
        body: t('translator.errorGeneratePdf'),
        level: 'error',
      });
    } finally {
      setGeneratingPDF(false);
    }
  };

  const anyTranslating = pages.some((p) => p.isTranslating);
  const translatedCount = pages.filter((p) => p.translation).length;

  return (
    <div className="w-full px-3 sm:px-5 lg:px-6 space-y-6 pb-10 py-4 sm:py-6">
      <header className="flex flex-col sm:flex-row items-center justify-between pb-4 border-b border-black/5 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-[14px] flex items-center justify-center text-blue-600">
            <Languages size={24} strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-black/90 tracking-tight">{t('translator.title')}</h2>
            <p className="text-[13px] text-black/50 font-medium">
              {t('translator.subtitle', { lang: languageLabel(language) })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
          {pages.length > 0 && (
            <>
              <button
                type="button"
                onClick={translateAll}
                disabled={anyTranslating || batchProgress !== null}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-semibold bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {batchProgress ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Zap size={18} />
                )}
                {batchProgress
                  ? t('translator.progress', { done: batchProgress.done, total: batchProgress.total })
                  : t('translator.translateAll')}
              </button>
              <button
                type="button"
                onClick={generatePDF}
                disabled={generatingPDF}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {generatingPDF ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                {generatingPDF ? t('translator.downloadPreparing') : t('translator.downloadReady')}
              </button>
            </>
          )}

          <label className="cursor-pointer ios-glass-btn flex items-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-semibold text-black/70 hover:bg-white/60 border border-black/5">
            {loadingFile ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {loadingFile ? t('common.loading') : t('translator.uploadPdf')}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFileUpload}
              disabled={loadingFile}
            />
          </label>
        </div>
      </header>

      {batchProgress && (
        <div className="h-1.5 rounded-full bg-black/10 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
          />
        </div>
      )}

      {pages.length > 0 && (
        <p className="text-[12px] text-black/45 font-medium">
          {t('translator.stats', { translated: translatedCount, total: pages.length })}
          {' · '}
          {t('translator.fastPathHint')}
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 text-rose-600 text-[13px] font-semibold bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-500/20">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {pages.length === 0 && !loadingFile && (
        <div className="ios-glass rounded-[2rem] p-10 flex flex-col items-center justify-center min-h-[360px] border border-white/60 shadow-sm text-center">
          <FileText size={48} className="text-black/20 mb-4" />
          <h3 className="text-lg font-bold text-black/70 mb-2">{t('translator.emptyTitle')}</h3>
          <p className="text-[14px] text-black/50 max-w-md mb-2 font-medium">{t('translator.emptyHint')}</p>
        </div>
      )}

      {pages.length > 0 && (
        <div className="space-y-6">
          {pages.map((page) => (
            <PageRow
              key={page.id}
              page={page}
              contentRef={(el) => {
                contentRefs.current[page.id] = el;
              }}
              onTranslate={() => translateOne(page.id)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PageRow({
  page,
  contentRef,
  onTranslate,
  t,
}: {
  page: PageData;
  contentRef: (el: HTMLDivElement | null) => void;
  onTranslate: () => void;
  t: (key: UiTextKey, params?: Record<string, string | number>) => string;
}) {
  return (
    <div className="ios-glass p-5 rounded-[2rem] border border-white/60 shadow-lg flex flex-col xl:flex-row gap-5 bg-white/40">
      <div className="flex-1 rounded-2xl overflow-hidden border border-black/10 bg-white relative min-h-[320px] xl:max-w-[50%]">
        <div className="absolute top-2 left-2 bg-black/60 text-white text-[11px] font-bold px-2 py-1 rounded-md z-10">
          {t('translator.pageOriginal', { n: page.id })}
        </div>
        <img src={page.originalImage} alt={`Page ${page.id}`} className="w-full h-full object-contain" />
      </div>

      <div className="flex items-center justify-center shrink-0 xl:w-16">
        <button
          type="button"
          onClick={onTranslate}
          disabled={page.isTranslating}
          className="w-12 h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl flex items-center justify-center shadow-lg disabled:opacity-50"
          title={t('translator.translatePageTitle')}
        >
          {page.isTranslating ? (
            <Loader2 size={22} className="animate-spin" />
          ) : (
            <ArrowRight size={22} className="rotate-90 xl:rotate-0" />
          )}
        </button>
      </div>

      <div className="flex-1 rounded-2xl border border-black/10 bg-white relative p-4 min-h-[320px] xl:max-w-[50%] overflow-auto">
        <div className="absolute top-2 left-2 bg-blue-600 text-white text-[11px] font-bold px-2 py-1 rounded-md z-10">
          {t('translator.pageTranslated', { n: page.id })}
        </div>

        {page.isTranslating && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2 rounded-2xl">
            <Loader2 size={28} className="animate-spin text-blue-500" />
            <p className="text-sm font-semibold text-blue-600">{t('translator.translating')}</p>
          </div>
        )}

        <div ref={contentRef} className="pt-8">
          <TranslationPreview page={page} t={t} />
        </div>
      </div>
    </div>
  );
}

function TranslationPreview({
  page,
  t,
}: {
  page: PageData;
  t: (key: UiTextKey, params?: Record<string, string | number>) => string;
}) {
  if (page.translatedError) {
    return <p className="text-rose-500 text-[13px] font-medium p-4">{page.translatedError}</p>;
  }

  if (!page.translation) {
    if (page.isTranslating) return null;
    return (
      <p className="text-black/30 italic text-[13px] p-6 text-center">{t('translator.notTranslated')}</p>
    );
  }

  if (page.translation.mode === 'text') {
    return (
      <article className="text-[13px] leading-relaxed text-black/85 whitespace-pre-wrap font-medium px-2 pb-2">
        {page.translation.translatedText}
      </article>
    );
  }

  return <VisualOverlay image={page.originalImage} blocks={page.translation.translatedBlocks} />;
}

function VisualOverlay({ image, blocks }: { image: string; blocks: TranslatedBlock[] }) {
  return (
    <div className="relative w-full">
      <img src={image} alt="Original" className="w-full h-auto block" />
      <div className="absolute inset-0 w-full h-full">
        {blocks.map((block, idx) => {
          const [ymin, xmin, ymax, xmax] = block.box;
          return (
            <div
              key={idx}
              style={{
                top: `${ymin / 10}%`,
                left: `${xmin / 10}%`,
                width: `${(xmax - xmin) / 10}%`,
                height: `${(ymax - ymin) / 10}%`,
              }}
              className="absolute bg-white text-black text-[8px] sm:text-[10px] leading-tight overflow-hidden p-0.5"
            >
              {block.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function imageRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.height / img.width);
    img.onerror = () => resolve(1.414);
    img.src = src;
  });
}
