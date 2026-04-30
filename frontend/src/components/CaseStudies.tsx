import React, { useState, useRef, useEffect, useContext } from 'react';
import { 
  Stethoscope, 
  Sparkles, 
  ArrowLeft, 
  Loader2,
  AlertCircle,
  FileText,
  Download,
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, CaseStudySession } from '../services/aiService';
import { AppLanguageContext, GlobalTopicContext } from '../App';
import { getCurrentLocalUser, normalizeUserRole } from '../utils/localStaffAuth';
import { appendCaseStudyToLibrary } from '../utils/staffContentLibrary';
import { loadLatestPreparedContent, savePreparedContent } from '../utils/preparedContentStore';

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export default function CaseStudies() {
  const globalTopic = useContext(GlobalTopicContext);
  const { language } = useContext(AppLanguageContext);
  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [caseSession, setCaseSession] = useState<CaseStudySession | null>(null);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);

  useEffect(() => {
    if (globalTopic) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic]);

  useEffect(() => {
    if (!topic.trim()) return;
    let mounted = true;
    (async () => {
      const prepared = await loadLatestPreparedContent<CaseStudySession>('case', topic);
      if (!mounted || !prepared) return;
      setCaseSession(prepared);
      setRevealedAnswers(new Array(prepared.questions.length).fill(false));
    })();
    return () => {
      mounted = false;
    };
  }, [topic]);
  const [error, setError] = useState<string | null>(null);

  const printRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async (currentTopic: string = topic) => {
    if (!currentTopic.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const data = await aiService.generateCaseStudy(currentTopic, language);
      const withImages = await Promise.all(
        (data.questions || []).map(async (q) => {
          const prompt =
            q.imagePrompt?.trim() ||
            `Realistic clinical educational photo for case about ${currentTopic}, high detail, no text overlay`;
          try {
            const imageUrl = await aiService.generateImage(prompt);
            return imageUrl ? { ...q, imageUrl } : q;
          } catch {
            return q;
          }
        })
      );
      const enriched: CaseStudySession = { ...data, questions: withImages };

      setCaseSession(enriched);
      setRevealedAnswers(new Array(enriched.questions.length).fill(false));
      await savePreparedContent('case', currentTopic, enriched);
      try {
        const u = getCurrentLocalUser();
        if (u && normalizeUserRole(u) === 'hodim') {
          appendCaseStudyToLibrary({
            authorUid: u.uid,
            authorName: u.displayName,
            session: enriched,
          });
        }
      } catch {
        /* bazaga yozish ixtiyoriy */
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError('Klinik keys yaratishda xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevealAnswer = (qIndex: number) => {
    setRevealedAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = !next[qIndex];
      return next;
    });
  };

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      const element = printRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const pageHeight = pdf.internal.pageSize.getHeight();
      let position = 0;
      let heightLeft = pdfHeight;
      
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = position - pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`Keys_Savollar_${caseSession?.topic.replace(/\s+/g, '_') || 'Hujjat'}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 print:p-0 print:max-w-none print:m-0">
      {!caseSession ? (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="ios-glass p-10 rounded-[2rem] text-center flex flex-col items-center justify-center space-y-5 print:hidden"
        >
          <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-600 font-bold text-2xl mb-2 backdrop-blur-md shadow-sm">
            <Stethoscope strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-black/90 tracking-tight">Klinik Keyslar Generator</h2>
            <p className="text-[13px] text-black/50 mt-1 font-medium">
              Jamoat salomatligi va tibbiy amaliyotga oid real vaziyatlarni AI yordamida shakllantirish.
            </p>
          </div>

          <div className="w-full max-w-lg space-y-4 pt-6">
            <div className="flex flex-col text-left space-y-2">
              <label className="text-[12px] font-semibold text-black/60 ml-2">Mavzu yoki tibbiy holat</label>
              <div className="relative group">
                <input 
                  type="text" 
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Masalan: Ko'krak bezi saratoni..." 
                  className="w-full h-12 px-5 bg-white/50 border border-white/60 shadow-sm rounded-2xl outline-none focus:bg-white/80 focus:border-emerald-400 transition-all text-[15px] text-black/90 placeholder:text-black/30 placeholder:font-medium"
                />
              </div>
            </div>

            <button 
              onClick={() => handleGenerate(topic)}
              disabled={loading || !topic.trim()}
              className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white shadow-lg shadow-emerald-600/20 rounded-2xl text-[14px] font-semibold transition-all flex items-center justify-center gap-2 mt-4"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
              3 ta batafsil keys yaratish
            </button>
            
            {error && (
              <div className="flex items-center gap-2 text-rose-600 text-[12px] font-semibold bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-500/20 mt-4">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>
        </motion.div>
      ) : (
        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
          <div className="flex items-center justify-between ios-glass p-3 rounded-[1.5rem] shadow-sm print:hidden">
            <button 
              onClick={() => setCaseSession(null)}
              className="px-4 py-2 flex items-center gap-2 text-[13px] font-semibold text-black/50 hover:text-emerald-600 transition-colors bg-white/40 hover:bg-white/60 rounded-xl"
            >
              <ArrowLeft size={16} /> Qidiruvga qaytish
            </button>
            <div className="flex items-center gap-2 font-mono text-[12px] font-medium text-black/40">
              Mavzu: <span className="font-bold text-black/70">{caseSession.topic}</span>
            </div>
            <button 
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="ios-glass-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-black/70 disabled:opacity-50"
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 
              {downloading ? "Yuklanmoqda..." : "PDF Yuklab olish"}
            </button>
          </div>

          <div ref={printRef} className="ios-glass rounded-[2rem] overflow-hidden shadow-lg border border-white/60 print:shadow-none print:border-none print:bg-transparent">
            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-8 border-b border-white/40 relative overflow-hidden print:bg-none print:border-b-2 print:border-black/10">
              <div className="flex items-center gap-3 mb-4 relative z-10">
                <div className="w-8 h-8 rounded-xl bg-white/60 shadow-sm border border-white flex items-center justify-center text-emerald-600 print:border-emerald-600">
                  <FileText size={16} />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-600/70 print:text-black">TIBBIY KEYSLAR TO'PLAMI</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-black/90 relative z-10 leading-tight pr-10">{caseSession.topic}</h1>
            </div>
            
            <div className="p-8 space-y-10 bg-white/40 print:bg-transparent">
              <div className="space-y-12">
                {caseSession.questions.map((q, i) => (
                  <div key={i} className="space-y-5 print:break-inside-avoid">
                    <div className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-[10px] bg-emerald-500/10 flex items-center justify-center text-emerald-700 text-[13px] font-bold border border-emerald-500/20">{i + 1}</span>
                      <div className="space-y-4 flex-1">
                        <p className="font-medium text-black/90 text-[15px] leading-relaxed pt-1 whitespace-pre-wrap">
                          {q.scenario}
                        </p>
                        
                        {q.imageUrl && (
                          <div className="my-4 rounded-xl overflow-hidden border border-black/10 shadow-sm flex items-center justify-center bg-black/5 p-2"
                               onError={(e) => {
                                 (e.currentTarget as HTMLDivElement).style.display = 'none';
                               }}>
                             <img src={q.imageUrl} alt={`Case illustration ${i+1}`} className="max-h-[300px] object-contain rounded-lg"
                                  onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }} />
                          </div>
                        )}
                        
                        <div className="pt-2">
                          <button
                            onClick={() => handleRevealAnswer(i)}
                            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-500 transition-all"
                          >
                            {revealedAnswers[i] ? "Javobni yashirish" : "Javobni aniqlash"}
                          </button>
                        </div>

                        {revealedAnswers[i] && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="bg-blue-500/5 mt-4 rounded-xl p-5 border border-blue-500/10 border-l-4 border-l-blue-500"
                          >
                            <h4 className="text-[12px] font-bold text-blue-800 uppercase tracking-wide mb-2 flex items-center gap-2">
                              <AlertCircle size={16}/>
                              Keys javobi:
                            </h4>
                            <p className="text-[14px] text-blue-900/80 leading-relaxed font-medium">
                              {q.answer}
                            </p>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-4 pt-6 mt-6 border-t border-black/5 print:hidden">
                <button 
                  onClick={() => setCaseSession(null)}
                  className="flex-1 py-4 bg-white/60 border border-black/10 text-black/80 rounded-2xl text-[14px] font-semibold hover:bg-white hover:border-black/20 transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={16} /> Yangi mavzu
                </button>
                <button 
                  onClick={() => handleGenerate(topic)}
                  disabled={loading}
                  className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl text-[14px] font-semibold hover:bg-emerald-500 shadow-xl shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} 
                  Yangi 3 ta keys yaratish
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
