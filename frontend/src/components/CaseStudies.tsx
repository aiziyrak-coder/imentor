import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import {
  Stethoscope,
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileText,
  Download,
  RefreshCw,
} from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, CaseStudySession } from '../services/aiService';
import { AppLanguageContext, GlobalTopicContext } from '../App';
import { getCurrentLocalUser, normalizeUserRole } from '../utils/localStaffAuth';
import { appendCaseStudyToLibrary } from '../utils/staffContentLibrary';
import {
  listPreparedForTopic,
  loadLatestPreparedContent,
  loadPreparedById,
  savePreparedContent,
  type PreparedContentSummary,
} from '../utils/preparedContentStore';
import ContentTopicToolbar from './staff/ContentTopicToolbar';
import { messageFromAiError } from '../utils/aiErrors';
import MedicalReferencesList from './staff/MedicalReferencesList';

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
  const [versions, setVersions] = useState<PreparedContentSummary[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const refreshVersions = useCallback(() => {
    if (!topic.trim()) {
      setVersions([]);
      return;
    }
    setVersions(listPreparedForTopic('case', topic));
  }, [topic]);

  const applySession = useCallback((data: CaseStudySession, versionId: string | null) => {
    setCaseSession(data);
    setRevealedAnswers(new Array(data.questions.length).fill(false));
    setActiveVersionId(versionId);
  }, []);

  useEffect(() => {
    if (globalTopic) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic]);

  useEffect(() => {
    refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (!topic.trim()) {
      setCaseSession(null);
      setActiveVersionId(null);
      return;
    }
    let mounted = true;
    (async () => {
      const prepared = await loadLatestPreparedContent<CaseStudySession>('case', topic);
      if (!mounted) return;
      refreshVersions();
      if (!prepared) {
        setCaseSession(null);
        setActiveVersionId(null);
        return;
      }
      const list = listPreparedForTopic('case', topic);
      const latestId = list[0]?.id ?? null;
      applySession(prepared, latestId);
    })();
    return () => {
      mounted = false;
    };
  }, [topic, applySession, refreshVersions]);

  const handleSelectVersion = async (id: string) => {
    const data = loadPreparedById<CaseStudySession>('case', id);
    if (data) applySession(data, id);
  };

  const handleGenerate = async (currentTopic: string = topic) => {
    if (!currentTopic.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const data = await aiService.generateCaseStudy(currentTopic, language);
      await savePreparedContent('case', currentTopic, data);
      refreshVersions();
      const list = listPreparedForTopic('case', currentTopic);
      applySession(data, list[0]?.id ?? null);
      try {
        const u = getCurrentLocalUser();
        if (u && normalizeUserRole(u) === 'hodim') {
          appendCaseStudyToLibrary({
            authorUid: u.uid,
            authorName: u.displayName,
            session: data,
          });
        }
      } catch {
        /* bazaga yozish ixtiyoriy */
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(messageFromAiError(err, "Klinik keys yaratishda xatolik yuz berdi. Iltimos qaytadan urinib ko'ring."));
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
        backgroundColor: '#ffffff',
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
      console.error('PDF generation error:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 print:p-0 print:max-w-none print:m-0">
      <ContentTopicToolbar
        topic={topic}
        onTopicChange={setTopic}
        topicLabel="Mavzu yoki tibbiy holat"
        topicPlaceholder="Masalan: Ko'krak bezi saratoni..."
        createLabel="Yangi 3 ta keys yaratish"
        loading={loading}
        onCreate={() => void handleGenerate(topic)}
        accent="emerald"
        versions={versions}
        activeVersionId={activeVersionId}
        onSelectVersion={(id) => void handleSelectVersion(id)}
        versionsTitle="Saqlangan keys to'plamlari"
      />

      {error && (
        <div className="flex items-center gap-2 text-rose-600 text-[12px] font-semibold bg-rose-500/10 px-4 py-3 rounded-xl border border-rose-500/20 print:hidden">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {loading && (
        <div className="ios-glass p-12 rounded-[2rem] flex flex-col items-center gap-4 print:hidden">
          <Loader2 className="animate-spin text-emerald-600" size={36} />
          <p className="text-[14px] font-medium text-black/60">AI 3 ta klinik keys va ilmiy manbalar tayyorlamoqda…</p>
        </div>
      )}

      {!loading && !caseSession && topic.trim() && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="ios-glass p-10 rounded-[2rem] text-center flex flex-col items-center gap-4 print:hidden"
        >
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-600">
            <Stethoscope strokeWidth={2} size={28} />
          </div>
          <p className="text-[14px] text-black/55 max-w-md">
            Bu mavzuda saqlangan keys topilmadi. Yuqoridagi <strong>Yangi 3 ta keys yaratish</strong> tugmasini
            bosing.
          </p>
        </motion.div>
      )}

      {!loading && caseSession && (
        <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
          <div className="flex items-center justify-between ios-glass p-3 rounded-[1.5rem] shadow-sm print:hidden flex-wrap gap-2">
            <div className="flex items-center gap-2 font-mono text-[12px] font-medium text-black/40">
              Ko&apos;rish: <span className="font-bold text-black/70">{caseSession.topic}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleGenerate(topic)}
                disabled={loading}
                className="px-4 py-2 flex items-center gap-2 text-[13px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl border border-emerald-200"
              >
                <RefreshCw size={16} />
                Yana yangi keys
              </button>
              <button
                type="button"
                onClick={handleDownloadPDF}
                disabled={downloading}
                className="ios-glass-btn flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-black/70 disabled:opacity-50"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                PDF
              </button>
            </div>
          </div>

          <div
            ref={printRef}
            className="ios-glass rounded-[2rem] overflow-hidden shadow-lg border border-white/60 print:shadow-none print:border-none print:bg-transparent"
          >
            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/5 p-8 border-b border-white/40 relative overflow-hidden print:bg-none print:border-b-2 print:border-black/10">
              <div className="flex items-center gap-3 mb-4 relative z-10">
                <div className="w-8 h-8 rounded-xl bg-white/60 shadow-sm border border-white flex items-center justify-center text-emerald-600 print:border-emerald-600">
                  <FileText size={16} />
                </div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-600/70 print:text-black">
                  TIBBIY KEYSLAR TO&apos;PLAMI
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-black/90 relative z-10 leading-tight pr-10">
                {caseSession.topic}
              </h1>
            </div>

            <div className="p-8 space-y-10 bg-white/40 print:bg-transparent">
              {caseSession.references && caseSession.references.length > 0 && (
                <MedicalReferencesList references={caseSession.references} className="print:break-inside-avoid" />
              )}
              <div className="space-y-12">
                {caseSession.questions.map((q, i) => (
                  <div key={i} className="space-y-5 print:break-inside-avoid">
                    <div className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-[10px] bg-emerald-500/10 flex items-center justify-center text-emerald-700 text-[13px] font-bold border border-emerald-500/20">
                        {i + 1}
                      </span>
                      <div className="space-y-4 flex-1">
                        <p className="font-medium text-black/90 text-[15px] leading-relaxed pt-1 whitespace-pre-wrap">
                          {q.scenario}
                        </p>
                        <div className="pt-2 print:hidden">
                          <button
                            type="button"
                            onClick={() => handleRevealAnswer(i)}
                            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-500 transition-all"
                          >
                            {revealedAnswers[i] ? 'Javobni yashirish' : 'Javobni aniqlash'}
                          </button>
                        </div>
                        {revealedAnswers[i] && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="bg-blue-500/5 mt-4 rounded-xl p-5 border border-blue-500/10 border-l-4 border-l-blue-500"
                          >
                            <h4 className="text-[12px] font-bold text-blue-800 uppercase tracking-wide mb-2 flex items-center gap-2">
                              <AlertCircle size={16} />
                              Keys javobi:
                            </h4>
                            <p className="text-[14px] text-blue-900/80 leading-relaxed font-medium whitespace-pre-wrap">{q.answer}</p>
                            {q.references && q.references.length > 0 && (
                              <div className="mt-4">
                                <MedicalReferencesList
                                  references={q.references}
                                  title="Ushbu keys manbalari"
                                  compact
                                />
                              </div>
                            )}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
