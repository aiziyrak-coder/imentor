import React, { useState, useRef } from 'react';
import { 
  Languages, 
  Upload, 
  Download, 
  Loader2,
  ArrowRight,
  FileText,
  AlertCircle
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { aiService } from '../services/aiService';
import Markdown from 'react-markdown';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface PageData {
  id: number;
  originalImage: string;
  translatedBlocks?: { box: [number, number, number, number], text: string }[] | null;
  translatedError?: string | null;
  isTranslating: boolean;
}

type RawTranslatedBlock = { box?: unknown; text?: unknown };

function normalizeTranslatedBlocks(input: unknown): { box: [number, number, number, number]; text: string }[] {
  if (!Array.isArray(input)) return [];
  const normalized: { box: [number, number, number, number]; text: string }[] = [];
  for (const item of input as RawTranslatedBlock[]) {
    if (!item || !Array.isArray(item.box) || item.box.length !== 4) continue;
    const nums = item.box.map((v) => Number(v));
    if (nums.some((n) => Number.isNaN(n))) continue;
    const [ymin, xmin, ymax, xmax] = nums;
    if (ymax <= ymin || xmax <= xmin) continue;
    normalized.push({
      box: [ymin, xmin, ymax, xmax],
      text: typeof item.text === 'string' ? item.text : '',
    });
  }
  return normalized;
}

export default function Translator() {
  const [pages, setPages] = useState<PageData[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  
  const contentRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError("Faqat PDF fayllar yuklash mumkin.");
      return;
    }

    setLoadingFile(true);
    setError(null);
    setPages([]);

    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      
      const newPages: PageData[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); 
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport } as any).promise;
        
        const base64Image = canvas.toDataURL('image/jpeg', 0.8);
        newPages.push({
          id: i,
          originalImage: base64Image,
          translatedBlocks: null,
          isTranslating: false
        });
      }
      setPages(newPages);
    } catch (err) {
      console.error(err);
      setError("PDF faylni o'qishda xatolik yuz berdi. PDF.js worker sozlamalarini tekshiring.");
    } finally {
      setLoadingFile(false);
    }
  };

  const translatePage = async (pageId: number) => {
    setPages(prev => prev.map(p => p.id === pageId ? { ...p, isTranslating: true, translatedBlocks: null, translatedError: null } : p));
    try {
      const page = pages.find(p => p.id === pageId);
      if (!page) return;
      
      const base64Data = page.originalImage.split(',')[1];
      const translated = await aiService.translatePageVisual(base64Data, 'Uzbek');
      const safeBlocks = normalizeTranslatedBlocks(translated);
      
      setPages(prev => prev.map(p => p.id === pageId ? { ...p, isTranslating: false, translatedBlocks: safeBlocks } : p));
    } catch (err) {
      console.error("Tarjima xatosi:", err);
      setPages(prev => prev.map(p => p.id === pageId ? { ...p, isTranslating: false, translatedError: "Tarjima xatosi yuz berdi. Iltimos, qayta urinib ko'ring." } : p));
    }
  };

  const generatePDF = async () => {
    if (pages.length === 0) return;
    setGeneratingPDF(true);
    
    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: 'a4'
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (i > 0) pdf.addPage();

        const img = new Image();
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = page.originalImage;
        });

        const imgRatio = img.height / img.width;
        const drawHeight = pdfWidth * imgRatio;

        pdf.addImage(page.originalImage, 'JPEG', 0, 0, pdfWidth, drawHeight);

        if (page.translatedBlocks && page.translatedBlocks.length > 0) {
          pdf.setFillColor(255, 255, 255);
          pdf.setTextColor(0, 0, 0);
          
          for (const block of page.translatedBlocks) {
            const [ymin, xmin, ymax, xmax] = block.box;
            const x = (xmin / 1000) * pdfWidth;
            const y = (ymin / 1000) * drawHeight;
            const w = ((xmax - xmin) / 1000) * pdfWidth;
            const h = ((ymax - ymin) / 1000) * drawHeight;
            
            pdf.rect(x, y, w, h, 'F');
            
            let fontSize = 9;
            pdf.setFontSize(fontSize);
            const textLines = pdf.splitTextToSize(block.text, w - 4);
            pdf.text(textLines, x + 2, y + fontSize);
          }
        }
      }

      pdf.save('Kitob_Tarjima.pdf');
    } catch (err) {
      console.error("PDF yaratish xatosi:", err);
      alert("PDF yaratishda xatolik yuz berdi.");
    } finally {
      setGeneratingPDF(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10">
      <header className="flex flex-col sm:flex-row items-center justify-between pb-4 border-b border-black/5 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-[14px] flex items-center justify-center text-blue-600 backdrop-blur-md">
            <Languages size={24} strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-black/90 tracking-tight">
              Kitob va Jurnal Tarjimoni
            </h2>
            <p className="text-[13px] text-black/50 font-medium">PDF fayllarni sahifama-sahifa o'zbek tiliga o'giring.</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          {pages.length > 0 && (
            <button 
              onClick={generatePDF}
              disabled={generatingPDF}
              className="flex-1 sm:flex-none justify-center bg-blue-600 text-white flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold hover:bg-blue-500 shadow-md transition-all disabled:opacity-50"
            >
              {generatingPDF ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {generatingPDF ? 'Tayyorlanmoqda...' : 'Tayyorni Yuklash'}
            </button>
          )}

          <label className="flex-1 sm:flex-none justify-center cursor-pointer ios-glass-btn flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-black/70 hover:bg-white/60 transition-all border border-black/5">
            {loadingFile ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {loadingFile ? 'Yuklanmoqda...' : 'PDF Yuklash'}
            <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} disabled={loadingFile} />
          </label>
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 text-rose-600 text-[13px] font-semibold bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-500/20">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {pages.length === 0 && !loadingFile && (
        <div className="ios-glass rounded-[2rem] p-10 flex flex-col items-center justify-center min-h-[400px] border border-white/60 shadow-sm text-center">
          <FileText size={48} className="text-black/20 mb-4" />
          <h3 className="text-lg font-bold text-black/70 mb-2">Hali fayl yuklanmadi</h3>
          <p className="text-[14px] text-black/50 max-w-sm mb-6 font-medium">
            Tarjima qilishni boshlash uchun yuqoridagi tugma orqali ilmiy maqola yoki kitobning PDF shaklini yuklang. Ehtiyot bo'ling, katta kitoblar yuklanishi biroz vaqt olishi mumkin.
          </p>
        </div>
      )}

      {pages.length > 0 && (
        <div className="space-y-6">
          {pages.map((page) => (
            <div key={page.id} className="ios-glass p-5 rounded-[2rem] border border-white/60 shadow-lg flex flex-col xl:flex-row gap-5 relative bg-white/40 items-stretch">
              
              {/* Left Side: Original Image */}
              <div className="flex-1 rounded-2xl overflow-hidden border border-black/10 shadow-inner bg-white relative min-h-[400px] xl:max-w-[50%]">
                <div className="absolute top-2 left-2 bg-black/60 text-white text-[11px] font-bold px-2 py-1 rounded-md z-10 shadow-md">
                  {page.id}-sahifa (Original)
                </div>
                <img 
                  src={page.originalImage} 
                  alt={`Sahifa ${page.id}`} 
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Middle: Controller Button */}
              <div className="flex items-center justify-center shrink-0 w-full xl:w-20 py-4 xl:py-0 relative z-10">
                <button
                  onClick={() => translatePage(page.id)}
                  disabled={page.isTranslating}
                  className="w-14 h-14 bg-blue-600 hover:bg-blue-500 active:scale-95 disabled:scale-100 text-white rounded-2xl flex items-center justify-center shadow-xl shadow-blue-600/30 transition-all disabled:opacity-50"
                  title="Ushbu sahifani tarjima qilish"
                >
                  {page.isTranslating ? <Loader2 size={24} className="animate-spin" /> : <ArrowRight size={24} className="rotate-90 xl:rotate-0" />}
                </button>
              </div>

              {/* Right Side: Translated Output */}
              <div 
                className="flex-1 rounded-2xl border border-black/10 shadow-inner bg-slate-100 flex items-center justify-center relative p-4 min-h-[400px] xl:max-w-[50%] overflow-hidden"
              >
                <div className="absolute top-2 left-2 bg-blue-600 text-white text-[11px] font-bold px-2 py-1 rounded-md z-30 shadow-md">
                  {page.id}-sahifa (Tarjima)
                </div>
                
                {page.isTranslating && (
                  <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-3 rounded-2xl">
                    <Loader2 size={32} className="animate-spin text-blue-500" />
                    <p className="text-sm font-semibold text-blue-600">AI vizual tarjima qilmoqda, kuting...</p>
                  </div>
                )}
                
                <div 
                  // @ts-ignore
                  ref={(el) => contentRefs.current[page.id] = el}
                  className="w-full relative"
                  style={{ maxWidth: '100%', backgroundColor: '#ffffff' }}
                >
                  {page.translatedBlocks && page.translatedBlocks.length > 0 ? (
                    <div className="relative w-full">
                      <img src={page.originalImage} alt="Original" className="w-full h-auto block" />
                      <div className="absolute inset-0 w-full h-full">
                        {page.translatedBlocks.map((block, idx) => {
                          const [ymin, xmin, ymax, xmax] = block.box;
                          const top = `${ymin / 10}%`;
                          const left = `${xmin / 10}%`;
                          const width = `${(xmax - xmin) / 10}%`;
                          const height = `${(ymax - ymin) / 10}%`;

                          return (
                            <div 
                              key={idx} 
                              style={{ 
                                top, left, width, height,
                                backgroundColor: '#ffffff',
                                color: '#000000',
                              }} 
                              className="absolute p-0.5 sm:p-1 text-[7px] sm:text-[9px] md:text-[11px] leading-tight overflow-hidden flex items-start justify-start text-left"
                            >
                              {block.text}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : page.translatedError ? (
                     <div className="p-10 text-center text-rose-500 font-medium">
                        {page.translatedError}
                     </div>
                  ) : (
                    !page.isTranslating && (
                      <div className="p-20 flex items-center justify-center text-black/30 font-medium italic">
                        Tarjima Qilinmadi (Original holatda qoladi)
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
