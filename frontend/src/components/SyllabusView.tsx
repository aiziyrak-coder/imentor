import React, { useState, useEffect } from 'react';
import { Upload, FileText, Loader2, BookOpen, FlaskConical, ArrowRight, Trash2, File } from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, SyllabusTopic } from '../services/aiService';

interface SyllabusDocument {
  id: string;
  fileName: string;
  topics: SyllabusTopic[];
  createdAt: number;
}

interface SyllabusViewProps {
  onSelectTopic: (topic: SyllabusTopic) => void;
}

export default function SyllabusView({ onSelectTopic }: SyllabusViewProps) {
  const LOCAL_SYLLABUS_KEY = 'salomatlik-local-syllabuses-v1';
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [syllabuses, setSyllabuses] = useState<SyllabusDocument[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SYLLABUS_KEY);
      if (!raw) {
        setSyllabuses([]);
      } else {
        const parsed = JSON.parse(raw) as SyllabusDocument[];
        setSyllabuses(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setError("Saqlangan syllabuslarni o'qishda xatolik yuz berdi.");
      setSyllabuses([]);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const extractedTopics = await aiService.extractSyllabusTopics(file);

      const newItem: SyllabusDocument = {
        id: `local_syl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        topics: extractedTopics,
        createdAt: Date.now(),
      };

      setSyllabuses(prev => {
        const next = [newItem, ...prev];
        localStorage.setItem(LOCAL_SYLLABUS_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      setError("Syllabusni tahlil qilishda xatolik yuz berdi. PDF ni tekshirib qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };
  
  const handleDeleteSyllabus = async (id: string, fileName: string) => {
    if (!confirm(`Haqiqatan ham "${fileName}" syllabusini o'chirmoqchimisiz?`)) return;
    try {
      setSyllabuses(prev => {
        const next = prev.filter(s => s.id !== id);
        localStorage.setItem(LOCAL_SYLLABUS_KEY, JSON.stringify(next));
        return next;
      });
    } catch (err) {
      setError("Syllabusni o'chirishda xatolik yuz berdi.");
    }
  };

  if (initialLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={48} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 h-full flex flex-col gap-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-6xl mx-auto w-full bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Mavzuni tanlang</h2>
          <p className="text-gray-500 mt-1">Syllabus tarkibidan ajratib olingan mavzular ro'yxati. Qaysi mavzu bo'yicha mashg'ulot o'tmoqchisiz?</p>
        </div>
        <div>
          <label className={`
            relative inline-flex items-center justify-center px-6 py-3 border-2 border-dashed rounded-xl cursor-pointer transition-all
            ${loading ? 'border-gray-200 bg-gray-50' : 'border-blue-300 bg-blue-50 hover:bg-blue-100'}
          `}>
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 size={20} className="animate-spin text-blue-500" />
                <span className="font-semibold text-blue-600 text-sm">O'qilmoqda...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Upload size={20} className="text-blue-600" />
                <span className="font-semibold text-blue-700 text-sm">Yangi PDF yuklash</span>
              </div>
            )}
            <input 
              type="file" 
              accept=".pdf" 
              className="hidden" 
              onChange={handleFileUpload} 
              disabled={loading}
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="max-w-6xl mx-auto w-full">
          <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm font-medium border border-rose-100">
            {error}
          </div>
        </div>
      )}

      {syllabuses.length === 0 ? (
        <div className="max-w-xl mx-auto w-full flex flex-col items-center mt-10">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-gray-100 w-full text-center relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-bl-[100px] -z-10" />
            <div className="absolute bottom-0 left-0 w-40 h-40 bg-purple-500/10 rounded-tr-[100px] -z-10" />

            <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
              <FileText size={48} className="text-blue-600" />
            </div>
            
            <h2 className="text-3xl font-extrabold text-gray-900 mb-3 tracking-tight">Syllabusni yuklang</h2>
            <p className="text-gray-500 font-medium leading-relaxed">Asosiy platformaga kirish uchun dastlab fan syllabusini (PDF) yuklang. Tizim undan mavzularni avtomatik ajratadi va doimiy saqlaydi.</p>
          </motion.div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto w-full space-y-12">
          {syllabuses.map((syllabus) => {
            const lectures = syllabus.topics.filter(t => t.type === 'lecture');
            const practicals = syllabus.topics.filter(t => t.type === 'practical');
            
            return (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={syllabus.id} 
                className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden"
              >
                {/* Header */}
                <div className="bg-gray-50/80 px-6 py-4 flex items-center justify-between border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-gray-200 flex items-center justify-center text-gray-600">
                      <File size={20} />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800 text-lg">{syllabus.fileName}</h3>
                      <p className="text-xs text-gray-500 font-medium">Yuklangan vaqti: {new Date(syllabus.createdAt).toLocaleString('uz-UZ')}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteSyllabus(syllabus.id, syllabus.fileName)}
                    className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Syllabusni o'chirish"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
                
                {/* Content */}
                <div className="p-6 md:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Lectures */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 pb-2">
                      <div className="bg-blue-50 text-blue-600 p-1.5 rounded-lg">
                        <BookOpen size={18} />
                      </div>
                      <h4 className="text-xl font-bold text-gray-800">Ma'ruzalar</h4>
                    </div>
                    {lectures.length > 0 ? (
                      <div className="grid gap-3">
                        {lectures.map((topic) => (
                          <button
                            key={topic.id}
                            onClick={() => onSelectTopic(topic)}
                            className="flex items-start gap-4 p-4 text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-300 hover:bg-blue-50/50 transition-all group"
                          >
                            <div className="w-11 h-11 bg-blue-50 text-blue-700 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                              {topic.id}
                            </div>
                            <div className="flex-1 mt-0.5">
                              <p className="font-medium text-gray-800 text-sm leading-snug group-hover:text-blue-900">{topic.title}</p>
                            </div>
                            <ArrowRight size={18} className="text-gray-300 group-hover:text-blue-500 transition-colors mt-2" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm italic">Ma'ruzalar topilmadi.</p>
                    )}
                  </div>

                  {/* Practicals */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 pb-2">
                      <div className="bg-indigo-50 text-indigo-600 p-1.5 rounded-lg">
                        <FlaskConical size={18} />
                      </div>
                      <h4 className="text-xl font-bold text-gray-800">Amaliy Mashg'ulotlar</h4>
                    </div>
                    {practicals.length > 0 ? (
                      <div className="grid gap-3">
                        {practicals.map((topic) => (
                          <button
                            key={topic.id}
                            onClick={() => onSelectTopic(topic)}
                            className="flex items-start gap-4 p-4 text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-300 hover:bg-indigo-50/50 transition-all group"
                          >
                            <div className="w-11 h-11 bg-indigo-50 text-indigo-700 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                              {topic.id}
                            </div>
                            <div className="flex-1 mt-0.5">
                              <p className="font-medium text-gray-800 text-sm leading-snug group-hover:text-indigo-900">{topic.title}</p>
                            </div>
                            <ArrowRight size={18} className="text-gray-300 group-hover:text-indigo-500 transition-colors mt-2" />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm italic">Amaliy mashg'ulotlar topilmadi.</p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
