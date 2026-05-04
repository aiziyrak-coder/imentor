import React, { useState, useEffect, useContext, useMemo } from 'react';
import {
  ClipboardList,
  Sparkles,
  Loader2,
  CheckCircle2,
  Brain,
  QrCode,
  Copy,
  Users,
  Send,
  BarChart3,
} from 'lucide-react';
import { motion } from 'motion/react';
import { aiService, TestSession, TestQuestion } from '../services/aiService';
import { AppLanguageContext, GlobalTopicContext } from '../App';
import { getCurrentLocalUser, normalizeUserRole } from '../utils/localStaffAuth';
import { appendTestToLibrary } from '../utils/staffContentLibrary';
import { loadLatestPreparedContent, savePreparedContent } from '../utils/preparedContentStore';
import {
  upsertLiveTestSessionOnServer,
  fetchLiveTestSessionFromServer,
  submitLiveTestOnServer,
  fetchLiveTestSubmissionsFromServer,
} from '../utils/liveTestApi';

interface LiveTestSessionDoc {
  topic: string;
  questions: TestQuestion[];
  createdAt: number;
}

interface TestSubmissionDoc {
  sessionId: string;
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
}

const LOCAL_TEST_SESSION_PREFIX = 'salomatlik-live-test-session-';
const LOCAL_TEST_SUBMISSIONS_PREFIX = 'salomatlik-live-test-submissions-';

function makeLocalSessionId(): string {
  return `lts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveLocalSession(sessionId: string, data: LiveTestSessionDoc): void {
  localStorage.setItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`, JSON.stringify(data));
}

function loadLocalSession(sessionId: string): LiveTestSessionDoc | null {
  try {
    const raw = localStorage.getItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as LiveTestSessionDoc;
  } catch {
    return null;
  }
}

function loadLocalSubmissions(sessionId: string): TestSubmissionDoc[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_TEST_SUBMISSIONS_PREFIX}${sessionId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TestSubmissionDoc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSubmissions(sessionId: string, list: TestSubmissionDoc[]): void {
  localStorage.setItem(`${LOCAL_TEST_SUBMISSIONS_PREFIX}${sessionId}`, JSON.stringify(list));
}

export default function TestQuestions() {
  const globalTopic = useContext(GlobalTopicContext);
  const { language } = useContext(AppLanguageContext);
  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isStudentMode = queryParams.get('mode') === 'student';
  /** QR ba'zan `id=` bilan chiqishi mumkin — ikkalasini qabul qilamiz */
  const studentSessionId = (queryParams.get('sid') || queryParams.get('id') || '').trim();

  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  const [loading, setLoading] = useState(false);
  const [testSession, setTestSession] = useState<TestSession | null>(null);

  useEffect(() => {
    if (globalTopic && !isStudentMode) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic, isStudentMode]);

  const setupTeacherLiveSession = (data: TestSession): string => {
    const sid = makeLocalSessionId();
    const doc: LiveTestSessionDoc = {
      topic: data.topic,
      questions: data.questions,
      createdAt: Date.now(),
    };
    saveLocalSession(sid, doc);
    saveLocalSubmissions(sid, []);
    setTeacherSessionId(sid);
    setJoinUrl(
      `${window.location.origin}${window.location.pathname}?mode=student&sid=${encodeURIComponent(sid)}`
    );
    setSubmissions([]);
    setShowAnalysis(false);
    void upsertLiveTestSessionOnServer(sid, {
      topic: doc.topic,
      questions: doc.questions,
      createdAt: doc.createdAt,
    }).catch(() => {
      /* o‘qituvchi API yo‘q bo‘lsa ham mahalliy QR ishlaydi (faqat shu brauzer) */
    });
    return sid;
  };

  const [error, setError] = useState<string | null>(null);
  const [teacherSessionId, setTeacherSessionId] = useState<string>('');
  const [joinUrl, setJoinUrl] = useState('');
  const [submissions, setSubmissions] = useState<TestSubmissionDoc[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const [studentFirstName, setStudentFirstName] = useState('');
  const [studentLastName, setStudentLastName] = useState('');
  const [studentAnswers, setStudentAnswers] = useState<number[]>([]);
  const [studentSubmitted, setStudentSubmitted] = useState(false);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentTest, setStudentTest] = useState<LiveTestSessionDoc | null>(null);

  const [sessionLoading, setSessionLoading] = useState(isStudentMode && !!studentSessionId);

  useEffect(() => {
    if (!isStudentMode || !studentSessionId) {
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    setError(null);

    (async () => {
      const local = loadLocalSession(studentSessionId);
      if (local) {
        if (!cancelled) {
          setStudentTest(local);
          setStudentAnswers(new Array(local.questions.length).fill(-1));
          setSessionLoading(false);
        }
        return;
      }
      try {
        const remote = await fetchLiveTestSessionFromServer(studentSessionId);
        if (cancelled) return;
        if (remote && remote.questions.length > 0) {
          const doc: LiveTestSessionDoc = {
            topic: remote.topic,
            questions: remote.questions,
            createdAt: remote.createdAt,
          };
          setStudentTest(doc);
          setStudentAnswers(new Array(doc.questions.length).fill(-1));
        } else {
          setError(
            "Test sessiyasi topilmadi. O'qituvchi testni yaratgan va QR yangilanganligini tekshiring."
          );
        }
      } catch {
        if (!cancelled) {
          setError("Serverga ulanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring.");
        }
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStudentMode, studentSessionId]);

  useEffect(() => {
    if (isStudentMode || !topic.trim()) return;
    let mounted = true;
    (async () => {
      const prepared = await loadLatestPreparedContent<TestSession>('test', topic);
      if (!mounted || !prepared) return;
      setTestSession(prepared);
      setupTeacherLiveSession(prepared);
    })();
    return () => {
      mounted = false;
    };
  }, [isStudentMode, topic]);

  useEffect(() => {
    if (isStudentMode || !teacherSessionId) return;

    const loadLocalNow = () => {
      const list = loadLocalSubmissions(teacherSessionId);
      list.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      return list;
    };

    let cancelled = false;
    const tick = async () => {
      try {
        const remote = await fetchLiveTestSubmissionsFromServer(teacherSessionId);
        if (cancelled) return;
        const mapped: TestSubmissionDoc[] = remote.map((r) => ({
          sessionId: teacherSessionId,
          firstName: r.firstName,
          lastName: r.lastName,
          answers: r.answers,
          submittedAt: r.submittedAt,
        }));
        setSubmissions(mapped.length > 0 ? mapped : loadLocalNow());
      } catch {
        if (!cancelled) setSubmissions(loadLocalNow());
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 4000);

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${LOCAL_TEST_SUBMISSIONS_PREFIX}${teacherSessionId}`) {
        setSubmissions(loadLocalNow());
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('storage', onStorage);
    };
  }, [isStudentMode, teacherSessionId]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const data = await aiService.generateTests(topic, 10, language);
      setTestSession(data);
      const sid = setupTeacherLiveSession(data);
      await savePreparedContent('test', topic, data);
      try {
        const u = getCurrentLocalUser();
        if (u && normalizeUserRole(u) === 'hodim') {
          appendTestToLibrary({
            authorUid: u.uid,
            authorName: u.displayName,
            liveSessionId: sid,
            testSession: data,
          });
        }
      } catch {
        /* bazaga yozish ixtiyoriy */
      }
    } catch (err) {
      console.error("Test generation error:", err);
      setError("Test savollarini shakllantirishda xatolik yuz berdi. Iltimos qayta urinib ko'ring.");
    } finally {
      setLoading(false);
    }
  };

  const handleStudentAnswer = (questionIndex: number, optionIndex: number) => {
    if (studentSubmitted) return;
    const next = [...studentAnswers];
    next[questionIndex] = optionIndex;
    setStudentAnswers(next);
  };

  const calculateScore = (answers: number[], questions: TestQuestion[]) => {
    return answers.filter((a, i) => a === questions[i].correctOptionIndex).length;
  };

  const handleStudentSubmit = async () => {
    if (!studentTest || !studentSessionId) return;
    if (!studentFirstName.trim() || !studentLastName.trim()) {
      setError("Ism va familiyani kiriting.");
      return;
    }
    if (studentAnswers.includes(-1)) {
      setError("Barcha savollarga javob bering.");
      return;
    }
    setStudentLoading(true);
    setError(null);
    try {
      await submitLiveTestOnServer(studentSessionId, {
        firstName: studentFirstName.trim(),
        lastName: studentLastName.trim(),
        answers: studentAnswers,
      });
      const item: TestSubmissionDoc = {
        sessionId: studentSessionId,
        firstName: studentFirstName.trim(),
        lastName: studentLastName.trim(),
        answers: studentAnswers,
        submittedAt: Date.now(),
      };
      const list = loadLocalSubmissions(studentSessionId);
      list.unshift(item);
      saveLocalSubmissions(studentSessionId, list);
      setStudentSubmitted(true);
    } catch (err) {
      console.error(err);
      setError("Yuborishda xatolik yuz berdi. Internetni tekshirib qayta urinib ko'ring.");
    } finally {
      setStudentLoading(false);
    }
  };

  if (isStudentMode) {
    return (
      <div className="h-full flex flex-col items-center bg-[#f2f2f7] p-2 sm:p-4 md:p-8 overflow-y-auto">
        <div className="w-full max-w-4xl space-y-6 pb-20">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-gray-900">Talaba testi</h1>
            <p className="text-gray-500">Ism-familiyangizni kiriting va testni yuboring.</p>
          </div>
          {sessionLoading ? (
            <div className="bg-white rounded-3xl p-8 border border-gray-100 text-center">
              <Loader2 className="animate-spin text-indigo-600 mx-auto mb-3" />
              <p className="text-gray-600">Test sessiyasi yuklanmoqda...</p>
            </div>
          ) : error && !studentTest ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-3xl p-6 text-center font-medium">
              {error}
            </div>
          ) : studentTest ? (
            <>
              <div className="bg-white rounded-3xl p-6 border border-gray-100">
                <h2 className="text-xl font-bold text-gray-800 mb-4">{studentTest.topic}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={studentFirstName}
                    onChange={(e) => setStudentFirstName(e.target.value)}
                    placeholder="Ism"
                    disabled={studentSubmitted}
                    className="px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <input
                    value={studentLastName}
                    onChange={(e) => setStudentLastName(e.target.value)}
                    placeholder="Familiya"
                    disabled={studentSubmitted}
                    className="px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              <div className="space-y-6">
                {studentTest.questions.map((q, i) => (
                  <div key={i} className="bg-white rounded-3xl p-6 border border-gray-100">
                    <p className="font-bold text-gray-800 mb-4">{i + 1}. {q.question}</p>
                    <div className="space-y-2">
                      {q.options.map((opt, optIdx) => (
                        <button
                          key={optIdx}
                          onClick={() => handleStudentAnswer(i, optIdx)}
                          disabled={studentSubmitted}
                          className={`w-full text-left p-3 rounded-xl border ${
                            studentAnswers[i] === optIdx ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          {String.fromCharCode(65 + optIdx)}) {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {!studentSubmitted ? (
                <button
                  onClick={handleStudentSubmit}
                  disabled={studentLoading}
                  className="w-full h-12 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-500 flex items-center justify-center gap-2"
                >
                  {studentLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  Yuborish
                </button>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-xl font-semibold">
                  Javoblaringiz muvaffaqiyatli yuborildi. Rahmat!
                </div>
              )}
            </>
          ) : null}
          {error && studentTest && (
            <div className="bg-rose-50 text-rose-700 border border-rose-200 p-3 rounded-xl">{error}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center bg-[#f2f2f7] p-2 sm:p-4 md:p-8 overflow-y-auto">
      <div className="w-full max-w-4xl space-y-8 pb-32">
        <div className="text-center space-y-4 pt-4">
          <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-full font-semibold text-sm mb-4">
            <ClipboardList size={16} />
            Teacher Test Sessiyasi + QR (10 savol)
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight">
            Bilimni sinash uchun <br className="hidden sm:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
              Diagnostik Testlar
            </span>
          </h1>
          <p className="text-gray-500 text-lg max-w-2xl mx-auto font-medium">
            Test yarating, katta QR ni ekranda ko'rsating, talabalar skaner qilib ishlasin. Standart: 10 ta murakkab savol.
          </p>
        </div>

        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white p-2 flex flex-col sm:flex-row shadow-xl rounded-2xl border border-gray-100 gap-2 max-w-3xl mx-auto items-center"
        >
          <input
            type="text"
            className="flex-1 px-5 py-4 min-w-[200px] outline-none text-gray-800 font-medium placeholder:text-gray-400 bg-transparent w-full"
            placeholder="Qanday mavzuda test tuzmoqchisiz? (Masalan: Yurak qon-tomir)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !topic.trim()}
            className="bg-gray-900 text-white w-full sm:w-auto px-6 py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
            Yaratish
          </button>
        </motion.div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl max-w-3xl mx-auto text-center font-medium">
            {error}
          </div>
        )}

        {loading && (
          <div className="py-20 flex flex-col items-center justify-center">
            <div className="relative w-20 h-20 mb-6">
              <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
              <Brain size={28} className="absolute inset-0 m-auto text-indigo-600 animate-pulse" />
            </div>
            <p className="text-gray-500 font-medium animate-pulse text-lg">
              AI test savollarini shakllantirmoqda...
            </p>
            <p className="text-gray-400 text-sm mt-2 max-w-md text-center">
              Bu jarayon 10 ta murakkab klinik savolni tayyorlaydi.
            </p>
          </div>
        )}

        {testSession && !loading && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
              <h2 className="text-2xl font-bold text-gray-800">{testSession.topic}</h2>
              {joinUrl && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
                  <div className="lg:col-span-1 flex justify-center">
                    <div className="bg-white border-4 border-indigo-200 rounded-2xl p-4 shadow-md">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(joinUrl)}`}
                        alt="Student test QR"
                        className="w-72 h-72 sm:w-80 sm:h-80 object-contain"
                      />
                    </div>
                  </div>
                  <div className="lg:col-span-2 space-y-3">
                    <p className="text-sm text-gray-600">
                      Talabalar shu QR ni skaner qilib alohida oynada testga kirishadi.
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={joinUrl}
                        readOnly
                        className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs"
                      />
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(joinUrl);
                        }}
                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold flex items-center gap-2"
                      >
                        <Copy size={16} /> Link
                      </button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => setShowAnalysis(false)}
                        className={`px-4 py-2 rounded-xl font-semibold ${!showAnalysis ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                      >
                        <Users size={16} className="inline mr-1" /> Realtime javoblar
                      </button>
                      <button
                        onClick={() => setShowAnalysis(true)}
                        className={`px-4 py-2 rounded-xl font-semibold ${showAnalysis ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}
                      >
                        <BarChart3 size={16} className="inline mr-1" /> Testni tahlil qilish
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!showAnalysis ? (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50 font-semibold text-gray-700">
                  Realtime topshirgan talabalar ({submissions.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="px-4 py-3">Talaba</th>
                        <th className="px-4 py-3">Ball</th>
                        <th className="px-4 py-3">Vaqt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          <td className="px-4 py-3 font-medium">{s.firstName} {s.lastName}</td>
                          <td className="px-4 py-3">
                            {calculateScore(s.answers, testSession.questions)} / {testSession.questions.length}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {new Date(s.submittedAt).toLocaleString('uz-UZ')}
                          </td>
                        </tr>
                      ))}
                      {submissions.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                            Hali hech kim yubormadi...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {testSession.questions.map((q, i) => (
                  <div key={i} className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-gray-100">
                    <div className="flex items-start gap-4 mb-6">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg shrink-0">
                        {i + 1}
                      </div>
                      <p className="text-lg text-gray-800 font-bold leading-relaxed">{q.question}</p>
                    </div>
                    <div className="space-y-2">
                      {q.options.map((option, optIdx) => (
                        <div
                          key={optIdx}
                          className={`p-3 rounded-xl border ${
                            optIdx === q.correctOptionIndex
                              ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                              : 'border-gray-200 bg-white text-gray-700'
                          }`}
                        >
                          {String.fromCharCode(65 + optIdx)}) {option}
                          {optIdx === q.correctOptionIndex && (
                            <span className="ml-2 inline-flex items-center text-xs font-semibold">
                              <CheckCircle2 size={14} className="mr-1" /> To'g'ri
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl p-4">
                      <h4 className="font-semibold text-blue-800 mb-1 flex items-center gap-2">
                        <Brain size={16} /> To'g'ri javob tahlili
                      </h4>
                      <p className="text-blue-800/90">{q.explanation}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setTestSession(null);
                  setTeacherSessionId('');
                  setJoinUrl('');
                  setSubmissions([]);
                  setShowAnalysis(false);
                }}
                className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-500 transition-colors"
              >
                Yangi yaratish
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
