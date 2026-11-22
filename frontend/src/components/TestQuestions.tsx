import { contentLanguageFor } from '../utils/syllabusInstructionLanguage';
import React, { useCallback, useState, useEffect, useContext, useMemo, useRef } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  Brain,
  Copy,
  Users,
  Send,
  Download,
  KeyRound,
  Lock,
  ArrowLeft,
  ClipboardList,
  ScanFace,
  UserCheck,
} from 'lucide-react';
import FaceLogin from './auth/FaceLogin';
import { motion } from 'motion/react';
import { TOO_FEW_QUESTIONS, aiService, TestSession, TestQuestion } from '../services/aiService';
import { AppLanguageContext, GlobalTopicContext } from '../App';
import type { AppLanguage } from '../i18n/language';
import { useTranslate, useUiText } from '../i18n/useUiText';
import LiveMonitorHost from './live/LiveMonitorHost';
import QuestionSource from './staff/QuestionSource';
import StudentMonitorRunner from './live/StudentMonitorRunner';
import { getCurrentLocalUser, logoutLocalStaff, normalizeUserRole, type LocalStaffUser } from '../utils/localStaffAuth';
import { chooseSessionRole, choosableRoles, clearBackendAuthTokens, getBackendAccessToken } from '../utils/backendAuth';
import IdLogin from './auth/IdLogin';
import { topicTitleFor } from '../utils/syllabusI18n';
import { fetchQuestionPool,
  listPreparedForTopicResult,
  loadLatestPreparedContent,
  loadPreparedByIdSynced,
  savePreparedContent,
  patchPreparedContentPayload,
  deletePreparedContent,
  normTopicKey,
  type PreparedContentSummary,
  type PreparedListResult,
} from '../utils/preparedContentStore';
import { buildPreparedContentMeta } from '../utils/preparedContentMeta';
import ContentTopicToolbar, { StaffToolbarButton } from './staff/ContentTopicToolbar';
import { useLocalizedTopic } from '../i18n/useLocalizedTopic';
import { copyTextToClipboard } from '../utils/copyText';
import StaffPageLayout from './staff/StaffPageLayout';
import StaffErrorAlert from './staff/StaffErrorAlert';
import StaffLoading from './staff/StaffLoading';
import StaffPanel from './staff/StaffPanel';
import TranslationGate from './staff/TranslationGate';
import TranslationReviewBar from './staff/TranslationReviewBar';
import { useTranslatedPayload } from '../i18n/useTranslatedPayload';
import { isTopicContextComplete, topicContextKey } from '../utils/syllabusTopicContext';
import { pushAppNotification } from '../utils/notifications';
import {
  STAFF_HEADING,
  staffBtnGhost,
  staffExplainBody,
  staffExplainBox,
  staffExplainTitle,
  staffIndexBadge,
  staffInput,
  staffOptionCorrect,
  staffOptionNeutral,
  staffQuestionText,
} from './staff/staffUi';
import { messageFromAiError } from '../utils/aiErrors';
import {
  syncLiveTestSessionToServer,
  upsertLiveTestSessionOnServer,
  fetchLiveTestSessionFromServer,
  submitLiveTestOnServer,
  fetchLiveTestSubmissionsFromServer,
  finalizeLiveTestSessionOnServer,
  upsertLiveTestDraftOnServer,
  getLiveTestParticipantKey,
  saveLocalLiveTestAnswers,
  loadLocalLiveTestAnswers,
  clearLocalLiveTestAnswers,
  countAnswered,
  sameAnswers,
  createLiveTestSessionOnServer,
  fetchMyLiveTestResult,
  type StudentTestQuestion,
  type LiveTestSubmissionRow,
  type LiveTestMyResult,
} from '../utils/liveTestApi';
import { postActivityEvents } from '../utils/analyticsApi';
import {
  bindLiveTestVisibilityTracking,
  flushLiveTestEvents,
  pushLiveTestEvent,
} from '../utils/liveTestAnticheat';
import { formatClock, studentOrder } from '../utils/liveTestShuffle';
import QRCode from 'qrcode';
import { LIVE_SESSION_PREFIX, LIVE_SUBMISSIONS_PREFIX } from '../utils/liveTestStorage';
import { HttpError } from '../api/httpClient';
import type { UiTextKey } from '../i18n/translations';
import MedicalReferencesList from './staff/MedicalReferencesList';
import {
  downloadTestAnswerKeyPdf,
  downloadTestResultsPdf,
} from '../utils/buildTestPdf';
import { gradeBadgeClass, scoreToGrade } from '../utils/testGrading';
import { stripOptionLabels } from '../utils/testOptionText';
import { DEFAULT_TEST_QUESTION_COUNT } from '../utils/testDifficulty';
import { loadLatestLectureText } from '../utils/lectureExcerpt';
import { hydrateGenerationScope, makeGenerationScope } from '../utils/subjectDomain';

interface LiveTestSessionDoc {
  topic: string;
  questions: TestQuestion[] | StudentTestQuestion[];
  createdAt: number;
}

function stripQuestionsForStudentView(questions: TestQuestion[]): StudentTestQuestion[] {
  return questions.map((q) => {
    const item: StudentTestQuestion = {
      question: q.question,
      options: q.options,
    };
    if (q.references?.length) item.references = q.references;
    return item;
  });
}

/** Shu brauzerda kirgan talaba (javoblar va ishtirokchi kaliti shunga bog'lanadi). */
function studentOwnerKey(): string {
  const u = getCurrentLocalUser();
  return normalizeUserRole(u) === 'student' && u ? u.uid || '' : '';
}

// Telefon avval kirgan talabani eslab qoladi. 2026-11-02 shikoyati: talaba QR'ni
// skanerlasa test do'stining hisobida ochilardi (do'sti bir marta uning telefonidan
// kirgan) — natija ham do'stiga yozilardi. Endi har QR testda "Siz shu talabamisiz?"
// deb so'raladi; javob shu tab yopilguncha eslab qolinadi (sahifa yangilansa qayta so'ramaydi).
const CONFIRMED_STUDENT_KEY = 'imentor:live-test-student:';

function confirmedStudent(sessionId: string): string {
  try {
    return sessionStorage.getItem(CONFIRMED_STUDENT_KEY + sessionId) || '';
  } catch {
    return '';
  }
}

function rememberConfirmedStudent(sessionId: string, uid: string): void {
  try {
    sessionStorage.setItem(CONFIRMED_STUDENT_KEY + sessionId, uid);
  } catch {
    /* maxfiy rejim — keyingi safar yana so'raladi */
  }
}

function saveStudentSession(sessionId: string, data: LiveTestSessionDoc): void {
  const safe: LiveTestSessionDoc = {
    topic: data.topic,
    createdAt: data.createdAt,
    questions: stripQuestionsForStudentView(data.questions as TestQuestion[]),
  };
  try {
    localStorage.setItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`, JSON.stringify(safe));
  } catch {
    // Private browsing or a full cache must not block a server-loaded test.
  }
}

interface TestSubmissionDoc {
  sessionId: string;
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
  /** Server hisoblagan ball. Bo'lsa — jadval SHUNI ko'rsatadi: brauzerdagi
   *  test nusxasi sessiyadagidan boshqa versiya bo'lishi mumkin. */
  correct?: number;
  total?: number;
  /** Test ochiq paytida: topshirdimi yoki yechmoqdami, nechta javob belgiladi (ball yo'q). */
  status?: 'submitted' | 'in_progress' | 'time_over';
  answered?: number;
  /** Vaqt chegarasi va kuzatuv (2026-10-22) — `LiveTestSubmissionRow` dagi kabi. */
  secondsLeft?: number | null;
  awayCount?: number;
  awaySec?: number;
  durationSec?: number;
  flags?: string[];
  sameAs?: string[];
}

const LOCAL_TEST_SESSION_PREFIX = LIVE_SESSION_PREFIX;
const LOCAL_TEST_SUBMISSIONS_PREFIX = LIVE_SUBMISSIONS_PREFIX;
const TEACHER_SID_BY_TOPIC = 'imentor-teacher-live-sid-v1';

function teacherSidStorageKey(topic: string): string {
  return `${TEACHER_SID_BY_TOPIC}:${normTopicKey(topic)}`;
}

function readStoredTeacherSid(topic: string): string | null {
  try {
    return sessionStorage.getItem(teacherSidStorageKey(topic));
  } catch {
    return null;
  }
}

function writeStoredTeacherSid(topic: string, sid: string): void {
  try {
    sessionStorage.setItem(teacherSidStorageKey(topic), sid);
  } catch {
    /* ignore */
  }
}

/** Jonli sessiya qaysi Baza versiyasidan boshlangan — mavzuga qaytilganda
 * sessiya shu versiya bilan tiklanadi. */
function teacherSidVersionKey(sid: string): string {
  return `${TEACHER_SID_BY_TOPIC}:ver:${sid}`;
}

function readStoredSidVersion(sid: string): string | null {
  try {
    return sessionStorage.getItem(teacherSidVersionKey(sid));
  } catch {
    return null;
  }
}

function writeStoredSidVersion(sid: string, versionId: string | null): void {
  try {
    if (versionId) sessionStorage.setItem(teacherSidVersionKey(sid), versionId);
    else sessionStorage.removeItem(teacherSidVersionKey(sid));
  } catch {
    /* ignore */
  }
}

/** Yangi test uchun jonli sessiya (QR) fonda ochildi — shu mavzu sahifasi ochiq bo'lsa, uni tiklasin. */
const LIVE_SESSION_READY_EVENT = 'imentor:live-session-ready';

function clearStoredTeacherSid(topic: string): void {
  try {
    sessionStorage.removeItem(teacherSidStorageKey(topic));
  } catch {
    /* ignore */
  }
}

/**
 * Jonli sessiya ochilmagan sabab — o'qituvchiga aniq aytiladi. Ilgari har
 * qanday xatoda bir xil "Sessiyani boshlab bo'lmadi" chiqardi va sababni
 * faqat server jurnalidan topish mumkin edi (2026-10-13).
 */
function startSessionErrorKey(err: unknown): UiTextKey {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return 'test.errorStartAuth';
    if (err.status === 409) return 'test.errorStartLocked';
    if (err.status === 422) return 'test.errorNoQuestions';
    if (err.status === 0) return 'test.errorStartNetwork';
    if (err.status >= 500) return 'test.errorStartServer';
  }
  if (err instanceof TypeError) return 'test.errorStartNetwork'; // fetch: tarmoq yo'q
  if (err instanceof Error && err.message === 'no-backend-token') return 'test.errorStartAuth';
  return 'test.errorStartSession';
}

/** Yopilgan test paneli teacher sahifasidan shuncha vaqtdan keyin avto yo'qoladi. */
const TEACHER_SESSION_AUTO_HIDE_MS = 60 * 60 * 1000;

/** Savollar to'plamining barmoq izi — sessiyani qayta ishlatish AYNAN
 * shu savollar bo'lgandagina xavfsiz. Ilgari faqat mavzu va savollar SONI
 * solishtirilardi: 10 savolli testni qayta yaratganda eski sessiya qayta
 * ishlatilib, allaqachon topshirgan talabalarning javoblari YANGI kalit
 * bo'yicha baholanardi. */
function questionsFingerprint(questions: Array<TestQuestion | StudentTestQuestion>): string {
  return questions
    .map((q) => {
      const correct =
        'correctOptionIndex' in q && typeof q.correctOptionIndex === 'number'
          ? q.correctOptionIndex
          : -1;
      return `${(q.question || '').trim()}|${(q.options || []).join('¦')}|${correct}`;
    })
    .join('||');
}

function tryReuseTeacherSessionId(data: TestSession): string | null {
  const stored = readStoredTeacherSid(data.topic);
  if (!stored) return null;
  const doc = loadLocalSession(stored);
  if (!doc) return null;
  if (normTopicKey(doc.topic) !== normTopicKey(data.topic)) return null;
  if (doc.questions.length !== data.questions.length) return null;
  // Saqlangan sessiya talabalar ko'rinishida bo'lishi mumkin (to'g'ri javobsiz) —
  // shuning uchun savol/variant matnlari bo'yicha solishtiramiz.
  // To'g'ri javob indeksi ham solishtiriladi — kalit o'zgargan bo'lsa eski
  // sessiya qayta ishlatilmaydi (ilgari indeks olib tashlanib solishtirilardi).
  const storedFp = questionsFingerprint(doc.questions as Array<TestQuestion | StudentTestQuestion>);
  const freshFp = questionsFingerprint(data.questions);
  if (storedFp !== freshFp) return null;
  return stored;
}

function saveLocalSession(sessionId: string, data: LiveTestSessionDoc): void {
  try {
    localStorage.setItem(`${LOCAL_TEST_SESSION_PREFIX}${sessionId}`, JSON.stringify(data));
  } catch {
    // Browser storage is optional. The live session and submissions are saved on the server.
  }
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
  try {
    localStorage.setItem(`${LOCAL_TEST_SUBMISSIONS_PREFIX}${sessionId}`, JSON.stringify(list));
  } catch {
    // Browser storage is optional. The live session and submissions are saved on the server.
  }
}

export default function TestQuestions() {
  const globalTopic = useContext(GlobalTopicContext);
  const { language } = useContext(AppLanguageContext);
  const { t, locale } = useUiText();
  const queryParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isStudentMode = queryParams.get('mode') === 'student';
  /** QR ba'zan `id=` bilan chiqishi mumkin — ikkalasini qabul qilamiz */
  const studentSessionId = (queryParams.get('sid') || queryParams.get('id') || '').trim();

  const [topic, setTopic] = useState(globalTopic ? globalTopic.title : '');
  /** Qaysi mavzu uchun test yaratilmoqda — mavzu almashsa natija o'z
   *  mavzusiga saqlanadi, boshqa mavzu sahifasiga tushmaydi. */
  const [generatingKey, setGeneratingKey] = useState<string | null>(null);
  const topicKey = topicContextKey(globalTopic) || topic.trim();
  const topicKeyRef = useRef(topicKey);
  topicKeyRef.current = topicKey;
  /** Shu nusxa hali ekrandami: boshqa bo'limga o'tilsa sahifa yopiladi, `topicKeyRef` esa eski qiymatda qoladi. */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  /** Fonda ochilgan sessiya haqida signal kelganda sahifa holati qayta tiklanadi. */
  const [restoreTick, setRestoreTick] = useState(0);
  const loading = generatingKey !== null && generatingKey === topicKey;
  const busyElsewhere = generatingKey !== null && generatingKey !== topicKey;
  const [testSession, setTestSession] = useState<TestSession | null>(null);
  const [versions, setVersions] = useState<PreparedContentSummary[]>([]);
  /** Versiyalar ro'yxati Bazadan kelmadi — "hali saqlanmagan" deb ko'rsatilmaydi. */
  const [versionsLoadFailed, setVersionsLoadFailed] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [viewLang, setViewLang] = useState<AppLanguage>(language);

  const generationDomain = useMemo(
    () =>
      makeGenerationScope({
        topic,
        subjectName: globalTopic?.subjectName,
        departmentName: globalTopic?.departmentName,
        subjectCode: globalTopic?.subjectCode,
      }).domain,
    [topic, globalTopic?.subjectName, globalTopic?.departmentName, globalTopic?.subjectCode],
  );

  useEffect(() => {
    setViewLang(language);
  }, [language]);

  const availableTestLangs: AppLanguage[] = ['uz', 'ru', 'en'];

  /** Ro'yxat natijasini qo'llash: xato bo'lsa eski ro'yxat o'chirilmaydi, faqat
   *  xato belgisi qo'yiladi (bo'sh "hali saqlanmagan" holati chiqmasin). */
  const applyVersionsResult = React.useCallback((res: PreparedListResult) => {
    if (res.ok) {
      setVersions(res.items);
      setVersionsLoadFailed(false);
    } else {
      console.warn('Test versions load failed', res.error);
      setVersionsLoadFailed(true);
    }
  }, []);

  const refreshVersions = React.useCallback(() => {
    const lookup = globalTopic ?? topic;
    if (!topic.trim() && !globalTopic) {
      setVersions([]);
      setVersionsLoadFailed(false);
      return;
    }
    void listPreparedForTopicResult('test', lookup).then(applyVersionsResult);
  }, [topic, globalTopic, applyVersionsResult]);

  useEffect(() => {
    if (globalTopic && !isStudentMode) {
      setTopic(globalTopic.title);
    }
  }, [globalTopic, isStudentMode]);

  const setupTeacherLiveSession = async (data: TestSession, reuseSid?: string): Promise<string> => {
    const questions: TestQuestion[] = data.questions;
    const doc: LiveTestSessionDoc = {
      topic: data.topic,
      questions,
      createdAt: Date.now(),
    };
    const subjectCode = globalTopic?.subjectCode || '';
    const payload = { ...doc, questions, subjectCode };
    const sid = reuseSid || (await createLiveTestSessionOnServer(payload));
    if (reuseSid) await upsertLiveTestSessionOnServer(sid, payload);
    saveLocalSession(sid, doc);
    saveLocalSubmissions(sid, []);
    setTeacherSessionId(sid);
    setSessionClosed(false);
    setClosedAtMs(null);
    setJoinUrl(
      `${window.location.origin}${window.location.pathname}?mode=student&sid=${encodeURIComponent(sid)}`
    );
    setSubmissions([]);
    setShowQuestions(true);
    writeStoredTeacherSid(data.topic, sid);
    writeStoredSidVersion(sid, activeVersionId);
    return sid;
  };

  /**
   * Sahifadan chiqib ketilgan paytda tayyor bo'lgan YANGI test uchun sessiya (2026-11-06).
   *
   * Shikoyat: "test yaratyapti, lekin QR chiqmayapti". O'qituvchi test yaratilayotganda
   * boshqa bo'limga o'tib qaytsa (Davlatov Sh.: 08:26:32 Testlar → 08:26:44 Sillabus →
   * 08:26:49 Testlar, test 08:27:08 da tayyor), sahifa qaytadan ochilgan bo'ladi: eski nusxa
   * "o'qituvchi bu yerda emas" deb QR ochmasdi, yangisi esa fonda tugayotgan testni bilmasdi.
   * Test bazada qolardi, sessiya serverda umuman ochilmasdi. Endi sessiya baribir ochiladi,
   * mavzu bo'yicha saqlanadi va shu mavzu sahifasi (ochiq bo'lsa — darhol) QR'ni ko'rsatadi.
   */
  const startLiveSessionInBackground = async (data: TestSession, subjectCode: string,
                                              versionId: string | null): Promise<string> => {
    const createdAt = Date.now();
    const sid = await createLiveTestSessionOnServer({ topic: data.topic, questions: data.questions, createdAt, subjectCode });
    saveLocalSession(sid, { topic: data.topic, questions: data.questions, createdAt });
    saveLocalSubmissions(sid, []);
    writeStoredTeacherSid(data.topic, sid);
    writeStoredSidVersion(sid, versionId);
    window.dispatchEvent(new CustomEvent(LIVE_SESSION_READY_EVENT, { detail: { topic: data.topic } }));
    return sid;
  };

  const [error, setError] = useState<string | null>(null);
  /** Claude banki tayyorlanayotgan bo'lsa — kutish tugash vaqti (2026-11-20). */
  const [bankWaitUntil, setBankWaitUntil] = useState<number | null>(null);
  const [teacherSessionId, setTeacherSessionId] = useState<string>('');
  const [joinUrl, setJoinUrl] = useState('');
  const [joinQrDataUrl, setJoinQrDataUrl] = useState('');
  const [qrRenderFailed, setQrRenderFailed] = useState(false);
  /** Talaba sahifasi: test tili va mavzu nomi shu tilda (2026-11-12 — ruscha testda sahifa o'zbekcha edi). */
  const [studentTestLang, setStudentTestLang] = useState<AppLanguage | null>(null);
  const [studentTopicDisplay, setStudentTopicDisplay] = useState('');
  /** Monitor rejimi (2026-11-12): savol monitorda, telefonda faqat variantlar — butun oqim `StudentMonitorRunner`da. */
  const [studentMonitor, setStudentMonitor] = useState(false);
  const [submissions, setSubmissions] = useState<TestSubmissionDoc[]>([]);
  /** true — savollar (tahlil bilan), false — talabalar natijalari jadvali. */
  const [showQuestions, setShowQuestions] = useState(true);
  const [downloadingKeyPdf, setDownloadingKeyPdf] = useState(false);
  const [downloadingResultsPdf, setDownloadingResultsPdf] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [closedAtMs, setClosedAtMs] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [startingSession, setStartingSession] = useState(false);

  const [studentFirstName, setStudentFirstName] = useState('');
  const [studentLastName, setStudentLastName] = useState('');
  // Talaba QR'ni skanerlagach avval yuz orqali kiradi; zaxira yo'l — JSHSHIR
  // yoki pasport. Parol bilan kirish olib tashlandi (2026-10-02).
  const [studentLoginMode, setStudentLoginMode] = useState<'face' | 'id'>('face');
  /** Telefonda saqlangan, lekin shu test uchun hali "bu men" deyilmagan talaba. */
  const [savedStudent, setSavedStudent] = useState<LocalStaffUser | null>(() => {
    const u = getCurrentLocalUser();
    if (!isStudentMode || !u || normalizeUserRole(u) !== 'student') return null;
    return confirmedStudent(studentSessionId) === u.uid ? null : u;
  });
  /** Kartani nima chiqardi: telefonda qolgan hisob yoki hozir raqam bilan kirish. */
  const [identityFrom, setIdentityFrom] = useState<'saved' | 'id'>('saved');
  const [studentAuthed, setStudentAuthed] = useState(() => {
    const u = getCurrentLocalUser();
    if (!u || normalizeUserRole(u) !== 'student') return false;
    return !isStudentMode || confirmedStudent(studentSessionId) === u.uid;
  });
  const [studentAnswers, setStudentAnswers] = useState<number[]>([]);
  /** Javob qoralamasi serverga yozilmadi (tarmoq/server) — qayta urinish ketmoqda. */
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const [draftRetryTick, setDraftRetryTick] = useState(0);
  const draftAttemptRef = useRef(0);
  const draftRetryTimerRef = useRef<number | null>(null);
  const [studentSubmitted, setStudentSubmitted] = useState(false);
  const [missingQuestion, setMissingQuestion] = useState<number | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);
  const [studentTest, setStudentTest] = useState<LiveTestSessionDoc | null>(null);
  /** Talabaning natijasi — o'qituvchi testni tahlil qilgandan keyin keladi. */
  const [myResult, setMyResult] = useState<LiveTestMyResult | null>(null);
  /** Vaqt chegarasi (2026-10-22): tugash payti (server soati bo'yicha) va soatlar farqi. */
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const clockOffsetRef = useRef(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const autoSubmitRef = useRef(false);
  const [timeUpSubmitted, setTimeUpSubmitted] = useState(false);
  /** Avtomatik topshirish yiqilganda qayta urinish (2026-10-23). */
  const [autoSubmitRetry, setAutoSubmitRetry] = useState(0);
  /** Serverdagi vaqt chegarasi (soniya); null — noma'lum (eski server yoki oflayn nusxa). */
  const [timeLimitSec, setTimeLimitSec] = useState<number | null>(null);

  const [sessionLoading, setSessionLoading] = useState(isStudentMode && !!studentSessionId);
  const serverSessionSyncedRef = useRef<string | null>(null);
  const participantKeyRef = useRef('');
  const testStartedAtRef = useRef<number | null>(null);
  const enrichTokenRef = useRef<symbol | null>(null);
  // Variant izohlari va tarjimalar test ko'ringandan KEYIN, fonda keladi.
  // Bu ko'rsatkichsiz o'qituvchi bo'sh izohlarni ko'rib "ishlamayapti" deb
  // o'ylaydi — aslida hali tayyorlanayotgan bo'ladi.
  const [enriching, setEnriching] = useState(false);

  // Test interfeys tilida (yoki til tugmasida tanlangan tilda) ko'rsatiladi.
  // Tarjima tayyor bo'lmasa savollar o'rnida "Tarjima qilinmoqda…" turadi —
  // ilgari bunday holda asl tildagi savollar indamay ko'rsatilardi.
  // Fon "enrich" (variant izohlari) tugaguncha tarjima so'ralmaydi: u matnni
  // o'zgartiradi va server tarjimani baribir qaytadan qiladi.
  const {
    view: displayedTest,
    status: rawTestStatus,
    retry: retryTestTranslation,
  } = useTranslatedPayload(testSession, enriching ? null : activeVersionId, viewLang, (next) =>
    setTestSession(next),
  );
  const testStatus = rawTestStatus === 'unsaved' && enriching ? 'translating' : rawTestStatus;
  const teacherSessionIdRef = useRef('');
  const sessionClosedRef = useRef(false);

  teacherSessionIdRef.current = teacherSessionId;
  sessionClosedRef.current = sessionClosed;

  const mapServerSubmissions = React.useCallback(
    (rows: LiveTestSubmissionRow[]) =>
      rows.map((r) => ({
        sessionId: teacherSessionId,
        firstName: r.firstName,
        lastName: r.lastName,
        answers: r.answers,
        submittedAt: r.submittedAt,
        correct: r.correct,
        total: r.total,
        status: r.status,
        answered: r.answered,
        secondsLeft: r.secondsLeft,
        awayCount: r.awayCount,
        awaySec: r.awaySec,
        durationSec: r.durationSec,
        flags: r.flags,
        sameAs: r.sameAs,
      })),
    [teacherSessionId]
  );

  const refreshSessionClosedFromServer = React.useCallback(async (sessionKey: string) => {
    if (!sessionKey) return;
    try {
      const remote = await fetchLiveTestSessionFromServer(sessionKey);
      if (remote) {
        setSessionClosed(Boolean(remote.isClosed));
        setClosedAtMs(remote.closedAtMs ?? null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setQrRenderFailed(false);
    setJoinQrDataUrl('');
    if (!joinUrl) return;
    let cancelled = false;
    void QRCode.toString(joinUrl, { type: 'svg', width: 420, margin: 4, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setJoinQrDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(url)}`);
      })
      .catch(() => {
        if (!cancelled) setQrRenderFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  useEffect(() => {
    if (!isStudentMode || !studentSessionId) {
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    setSessionLoading(true);
    setError(null);

    (async () => {
      participantKeyRef.current = getLiveTestParticipantKey(studentSessionId);

      const applyClosed = (closed: boolean) => {
        if (closed) {
          setSessionClosed(true);
          setError(t('test.sessionClosedStudentHint'));
        }
      };

      try {
        const remote = await fetchLiveTestSessionFromServer(studentSessionId);
        if (cancelled) return;
        if (!remote || remote.isClosed) {
          applyClosed(true);
          setSessionLoading(false);
          return;
        }
        if (remote && (remote.questions.length > 0 || remote.mode === 'monitor')) {
          const doc: LiveTestSessionDoc = {
            topic: remote.topic,
            questions: remote.questions,
            createdAt: remote.createdAt,
          };
          saveStudentSession(studentSessionId, doc);
          setStudentTest(doc);
          setTimeLimitSec(typeof remote.timeLimitSec === 'number' ? remote.timeLimitSec : null);
          setStudentTestLang(remote.language === 'ru' || remote.language === 'en' || remote.language === 'uz' ? remote.language : null);
          setStudentTopicDisplay(remote.topicDisplay || '');
          setStudentMonitor(remote.mode === 'monitor');
          setStudentAnswers(new Array(doc.questions.length).fill(-1));
          testStartedAtRef.current = Date.now();
          void postActivityEvents([{ event_type: 'live_test_opened' }], `live-test:${studentSessionId}`);
          setSessionLoading(false);
          return;
        }
      } catch {
        /* serverdan o'qib bo'lmasa local fallback */
      }

      const local = loadLocalSession(studentSessionId);
      if (local) {
        if (!cancelled) {
          const safe: LiveTestSessionDoc = {
            topic: local.topic,
            createdAt: local.createdAt,
            questions: stripQuestionsForStudentView(local.questions as TestQuestion[]),
          };
          setStudentTest(safe);
          setStudentAnswers(new Array(local.questions.length).fill(-1));
          testStartedAtRef.current = Date.now();
          void postActivityEvents([{ event_type: 'live_test_opened' }], `live-test:${studentSessionId}`);
          setSessionLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setError(t('test.sessionNotFound'));
        setSessionLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isStudentMode, studentSessionId]);

  // Sahifa yangilangan yoki telefon uxlab qolgan bo'lsa talaba to'xtagan
  // joyidan davom etadi (ilgari javoblar o'chib ketardi). Javoblar va
  // ishtirokchi kaliti KIRGAN TALABAGA bog'liq: bitta telefondan ikki talaba
  // yechsa, biri ikkinchisining javoblarini ko'rmaydi.
  useEffect(() => {
    if (!isStudentMode || !studentSessionId || !studentTest || !studentAuthed) return;
    const owner = studentOwnerKey();
    participantKeyRef.current = getLiveTestParticipantKey(studentSessionId, owner);
    const saved = loadLocalLiveTestAnswers(studentSessionId, studentTest.questions.length, owner);
    if (saved) setStudentAnswers(saved);
  }, [isStudentMode, studentSessionId, studentTest, studentAuthed]);

  // Talabaning javob qoralamasi fonda serverga yoziladi — telefon o'chsa yoki
  // sahifa yopilsa ish yo'qolmasin. MUHIM: bu effekt AYNAN talaba rejimi
  // uchun (avval shart teskari yozilgani uchun hech qachon ishlamagan).
  useEffect(() => {
    if (draftRetryTimerRef.current) {
      window.clearTimeout(draftRetryTimerRef.current);
      draftRetryTimerRef.current = null;
    }
    if (!isStudentMode || !studentSessionId || !studentTest || studentSubmitted || sessionClosed) return;
    if (!studentAuthed || studentMonitor) return;
    const sent = studentAnswers;
    const timer = window.setTimeout(() => {
      void upsertLiveTestDraftOnServer(studentSessionId, {
        participantKey: participantKeyRef.current,
        firstName: studentFirstName,
        lastName: studentLastName,
        answers: sent,
      })
        .then((saved) => {
          draftAttemptRef.current = 0;
          setDraftSaveFailed(false);
          if (saved.alreadySubmitted) {
            // Allaqachon topshirgan yoki test yopilganda javoblari qabul qilingan.
            clearLocalLiveTestAnswers(studentSessionId, studentOwnerKey());
            setStudentSubmitted(true);
            return;
          }
          if (saved.deadlineMs) {
            setDeadlineMs(saved.deadlineMs);
            clockOffsetRef.current = (saved.serverNowMs ?? Date.now()) - Date.now();
          }
          // Ilovadan chiqish kabi kuzatuv voqealari ham shu oraliqda yuboriladi —
          // topshirmay qolgan (vaqt tugagan) talabaniki ham tahlilga tushsin.
          void flushLiveTestEvents(studentSessionId, participantKeyRef.current).catch(() => undefined);
          if (saved.expired) {
            // Faqat farq bo'lsa yangilanadi: har safar yangi massiv effektni qayta ishga
            // tushirib, vaqt tugagach soniyasiga bir-ikki so'rov yuborilardi (2026-10-23).
            const next = saved.answers.length === sent.length ? saved.answers : sent;
            setStudentAnswers((now) => (sameAnswers(now, next) ? now : next));
            setDeadlineMs((d) => d ?? Date.now());
            return;
          }
          // Boshqa qurilma yoki oldingi oynadan saqlangan javoblar ko'proq
          // bo'lsa — o'shalar tiklanadi.
          if (saved.answers.length === sent.length && countAnswered(saved.answers) > countAnswered(sent)) {
            setStudentAnswers((now) => (now === sent ? saved.answers : now));
          }
        })
        .catch((err) => {
          if (err instanceof HttpError && err.status === 403) {
            setSessionClosed(true);
            setError(t('test.sessionClosedStudentHint'));
            return;
          }
          // Boshqa xatolar (tarmoq, 5xx) ilgari jim yutilardi — talaba javoblari
          // serverda yo'q ekanini bilmasdi. Endi kichik "saqlanmadi, qayta
          // urinilmoqda" belgisi chiqadi va kutish oshib boruvchi qayta urinish
          // (2, 4, 8 … 30 s) ishga tushadi. Javoblar telefonda (localStorage) turibdi.
          draftAttemptRef.current += 1;
          setDraftSaveFailed(true);
          const delay = Math.min(30_000, 2000 * 2 ** (draftAttemptRef.current - 1));
          if (draftRetryTimerRef.current) window.clearTimeout(draftRetryTimerRef.current);
          draftRetryTimerRef.current = window.setTimeout(() => {
            draftRetryTimerRef.current = null;
            setDraftRetryTick((n) => n + 1);
          }, delay);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    draftRetryTick,
    isStudentMode,
    studentSessionId,
    studentTest,
    studentSubmitted,
    sessionClosed,
    studentAuthed,
    studentFirstName,
    studentLastName,
    studentAnswers,
  ]);
  useEffect(
    () => () => {
      if (draftRetryTimerRef.current) window.clearTimeout(draftRetryTimerRef.current);
    },
    [],
  );

  // "Ilovadan chiqdi" kuzatuvi FAQAT test boshlangach (kirgach, vaqt sanalayotganda)
  // (2026-10-23): ilgari kirish ekranida JSHSHIR yoki pasport raqamini boshqa ilovadan
  // qidirgan talaba ham "shubhali" bo'lib qolardi.
  const watching = isStudentMode && Boolean(studentSessionId) && Boolean(studentTest) && studentAuthed
    && deadlineMs !== null && !studentSubmitted && !sessionClosed;
  useEffect(() => {
    if (!watching) return;
    const sid = studentSessionId;
    const stop = bindLiveTestVisibilityTracking(sid, () => {
      void flushLiveTestEvents(sid, participantKeyRef.current).catch(() => undefined);
    });
    // Telefon 30 soniyada o'zi qulflanadi — savolni o'ylab turgan talaba "chiqib ketgan"
    // bo'lib qolmasin: test paytida ekran yoniq turadi (brauzer qo'llasa).
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const takeLock = () => {
      if (document.hidden || !nav.wakeLock) return;
      nav.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    };
    takeLock();
    document.addEventListener('visibilitychange', takeLock);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', takeLock);
      void lock?.release().catch(() => undefined);
    };
  }, [watching, studentSessionId]);

  useEffect(() => {
    if (isStudentMode || !teacherSessionId) return;
    void refreshSessionClosedFromServer(teacherSessionId);
  }, [isStudentMode, teacherSessionId, refreshSessionClosedFromServer]);

  /**
   * Yopilgan (finalize qilingan) test paneli teacher sahifasida 60 daqiqa
   * ko'rinib turadi (natijalarni tahlil qilish uchun), so'ng avto yo'qoladi —
   * sahifa "yangi test yaratish" boshlang'ich holatiga qaytadi.
   */
  useEffect(() => {
    if (isStudentMode || !sessionClosed || !closedAtMs) return;
    const elapsed = Date.now() - closedAtMs;
    const remaining = TEACHER_SESSION_AUTO_HIDE_MS - elapsed;
    const resetPanel = () => {
      clearStoredTeacherSid(topic);
      setTestSession(null);
      setTeacherSessionId('');
      setJoinUrl('');
      setSubmissions([]);
      setSessionClosed(false);
      setClosedAtMs(null);
      setActiveVersionId(null);
    };
    if (remaining <= 0) {
      resetPanel();
      return;
    }
    const timer = window.setTimeout(resetPanel, remaining);
    return () => window.clearTimeout(timer);
  }, [isStudentMode, sessionClosed, closedAtMs, topic]);

  useEffect(() => {
    refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (isStudentMode || !topic.trim()) return;
    const lookup = globalTopic ?? topic;
    let mounted = true;
    setTestSession(null);
    setTeacherSessionId('');
    setJoinUrl('');
    setSubmissions([]);
    setSessionClosed(false);
    setClosedAtMs(null);
    setActiveVersionId(null);
    setShowQuestions(true);
    setEnriching(false);
    setError(null);
    // Sahifa toza ochiladi — avval yaratilgan test avtomatik ochilmaydi.
    // ISTISNO: shu mavzuda hali ochiq (yoki yaqinda yopilgan) jonli sessiya
    // bo'lsa, u tiklanadi. Ilgari mavzu almashtirilsa QR va natijalar
    // butunlay yo'qolardi va o'qituvchi sessiyani yakunlay olmasdi.
    (async () => {
      const listRes = await listPreparedForTopicResult('test', lookup);
      if (!mounted) return;
      applyVersionsResult(listRes);

      const sid = readStoredTeacherSid(topic);
      const doc = sid ? loadLocalSession(sid) : null;
      if (!sid || !doc) return;
      const remote = await fetchLiveTestSessionFromServer(sid).catch(() => null);
      if (!mounted || !remote) return;
      const closedAt = remote.closedAtMs ?? null;
      if (remote.isClosed && (!closedAt || Date.now() - closedAt >= TEACHER_SESSION_AUTO_HIDE_MS)) {
        clearStoredTeacherSid(topic);
        return;
      }
      const versionId = readStoredSidVersion(sid);
      const fromDb = versionId ? await loadPreparedByIdSynced<TestSession>('test', versionId) : null;
      if (!mounted) return;
      const restored: TestSession =
        fromDb ?? ({ topic: doc.topic, questions: doc.questions as TestQuestion[] } as TestSession);
      setTestSession(restored);
      setViewLang(language);
      setActiveVersionId(fromDb ? versionId : null);
      setTeacherSessionId(sid);
      setSessionClosed(Boolean(remote.isClosed));
      setClosedAtMs(closedAt);
      setJoinUrl(
        `${window.location.origin}${window.location.pathname}?mode=student&sid=${encodeURIComponent(sid)}`,
      );
      // Yopilgan (tahlil qilingan) sessiyaga qaytildi — natijalar ko'rsatiladi;
      // ochiq sessiyada natija yo'q, faqat savollar va talabalar jarayoni.
      setShowQuestions(!remote.isClosed);
      if (remote.isClosed) {
        // Yopilgan sessiyada so'rov (polling) ishlamaydi: natijalar shu yerda bir marta
        // olinadi. Ilgari tahlildan keyin F5 yoki mavzuga qaytish "0 natija" ko'rsatardi.
        const rows = await fetchLiveTestSubmissionsFromServer(sid).catch(() => null);
        if (mounted && rows) setSubmissions(mapServerSubmissions(rows).map((r) => ({ ...r, sessionId: sid })));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [isStudentMode, topic, globalTopic, refreshVersions, restoreTick]);

  // Shu mavzuning yangi testi uchun sessiya fonda ochildi (o'qituvchi test tayyorlanayotganda
  // chiqib qaytgan) — sahifa o'sha sessiyani QR bilan ko'rsatadi. Sahifada boshqa jonli sessiya
  // ochiq bo'lsa tegilmaydi.
  useEffect(() => {
    if (isStudentMode) return;
    const onReady = (event: Event) => {
      const ready = (event as CustomEvent<{ topic?: string }>).detail?.topic || '';
      if (!teacherSessionIdRef.current && normTopicKey(ready) === normTopicKey(topic)) {
        setRestoreTick((n) => n + 1);
      }
    };
    window.addEventListener(LIVE_SESSION_READY_EVENT, onReady);
    return () => window.removeEventListener(LIVE_SESSION_READY_EVENT, onReady);
  }, [isStudentMode, topic]);

  useEffect(() => {
    if (isStudentMode || !teacherSessionId || sessionClosed) return;

    const loadLocalNow = () => {
      const list = loadLocalSubmissions(teacherSessionId);
      list.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      return list;
    };

    let cancelled = false;
    const ensureServerSession = async (): Promise<void> => {
      if (serverSessionSyncedRef.current === teacherSessionId) return;
      const localDoc = loadLocalSession(teacherSessionId);
      if (!localDoc) return;
      const ok = await syncLiveTestSessionToServer(teacherSessionId, {
        topic: localDoc.topic,
        questions: localDoc.questions as TestQuestion[],
        createdAt: localDoc.createdAt,
      });
      if (ok) serverSessionSyncedRef.current = teacherSessionId;
    };

    const tick = async () => {
      // Tab fonda bo'lsa so'rov yubormaymiz — sessiya soatlab ochiq turishi mumkin.
      if (document.hidden) return;
      try {
        await ensureServerSession();
        const remote = await fetchLiveTestSubmissionsFromServer(teacherSessionId);
        if (cancelled) return;
        // Server javob berdi — u YAGONA haqiqat manbai. Ilgari ro'yxat bo'sh
        // bo'lsa localStorage'ga tushilardi va boshqa sessiyaning eski
        // yozuvlari "topshirganlar" bo'lib ko'rinardi.
        setSubmissions(mapServerSubmissions(remote));
      } catch {
        // Faqat server javob bermaganda — offline zaxira.
        if (!cancelled) setSubmissions(loadLocalNow());
      }
    };

    tick();
    // 2026-11-13: 4 s edi. Yangi testlar monitor rejimida — natijalar test yopilganda bir marta keladi
    // (`handleFinalizeSession`), ochiq paytda ro'yxat bo'sh; 20 dan ortiq sinf bir vaqtda testda bo'lganda
    // bu so'rov ham serverni yuklardi. Zaxira sifatida 20 soniyada bir.
    const intervalId = window.setInterval(tick, 20000);

    const onStorage = (e: StorageEvent) => {
      if (e.key === `${LOCAL_TEST_SUBMISSIONS_PREFIX}${teacherSessionId}`) {
        setSubmissions(loadLocalNow());
      }
    };
    window.addEventListener('storage', onStorage);
    // Tabga qaytilganda darhol yangilaymiz (fonda o'tkazib yuborilganlari uchun).
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isStudentMode, teacherSessionId, sessionClosed]);

  /** "Testni tahlil qilish": test darhol yakunlanadi — yechayotganlarning
   * belgilagan javoblari qabul qilinadi, belgilanmagani xato. Shundan keyingina
   * ekranda natijalar va tahlil, talabalar telefonida natijasi ochiladi. */
  const handleFinalizeSession = async (skipConfirm = false): Promise<boolean> => {
    if (!teacherSessionId || !testSession || sessionClosed) return Boolean(sessionClosed);
    const answering = submissions.filter((s) => s.status === 'in_progress').length;
    if (!skipConfirm && answering > 0 && !window.confirm(t('test.analyzeConfirm', { count: String(answering) }))) return false;
    setFinalizing(true);
    setError(null);
    try {
      const result = await finalizeLiveTestSessionOnServer(teacherSessionId);
      setSessionClosed(result.isClosed);
      setClosedAtMs(result.closedAtMs ?? Date.now());
      setSubmissions(mapServerSubmissions(result.submissions));
      setShowQuestions(false);
      return true;
    } catch (err) {
      console.error('Finalize error:', err);
      setError(t('test.errorFinalize'));
      return false;
    } finally {
      setFinalizing(false);
    }
  };

  const handleBackToQuestions = () => {
    setShowQuestions(true);
  };


  useEffect(() => {
    serverSessionSyncedRef.current = null;
  }, [teacherSessionId]);

  /** Bazadan variantni ochish — FAQAT ko'rsatadi.
   * Ilgari bu yerda darrov jonli sessiya (QR) yaratilardi: o'qituvchi
   * shunchaki savollarni ko'rmoqchi bo'lganda ham serverda sessiya paydo
   * bo'lardi. Endi sessiya alohida tugma bilan boshlanadi. */
  const handleSelectVersion = (id: string) => {
    if (teacherSessionId && !sessionClosed && id !== activeVersionId) {
      if (!window.confirm(t('test.regenerateConfirm'))) return;
      clearStoredTeacherSid(topic);
    }
    void (async () => {
      const data = await loadPreparedByIdSynced<TestSession>('test', id);
      if (!data) {
        setError(t('test.errorLoadVersion'));
        return;
      }
      setTestSession(data);
      setViewLang(language);
      setTeacherSessionId('');
      setJoinUrl('');
      setSubmissions([]);
      setSessionClosed(false);
      setClosedAtMs(null);
      setActiveVersionId(id);
      setShowQuestions(true);
      setError(null);
    })();
  };

  /** Jonli sessiyani (QR) ataylab boshlash. */
  const handleStartLiveSession = async () => {
    if (!testSession || teacherSessionId) return;
    // Savolsiz (buzuq) saqlangan versiya: server baribir rad etadi (422) —
    // o'qituvchiga sababni aniq aytamiz.
    if (!testSession.questions?.length) {
      setError(t('test.errorNoQuestions'));
      return;
    }
    // Jonli test kamida 10 savol bilan o'tadi (server ham shuni talab qiladi).
    // Eski, kam savolli versiyani qayta yaratish kerak.
    if (testSession.questions.length < DEFAULT_TEST_QUESTION_COUNT) {
      setError(
        t('test.errorTooFewQuestions', {
          have: testSession.questions.length,
          count: DEFAULT_TEST_QUESTION_COUNT,
        }),
      );
      return;
    }
    setStartingSession(true);
    setError(null);
    try {
      let reused = tryReuseTeacherSessionId(testSession);
      // Tahlil qilingan (yopilgan) sessiya qayta ochilmaydi (2026-10-23): ilgari shu
      // testni ikkinchi guruhga boshlaganda eski sessiya qaytib kelardi — QR bir lahza
      // chiqib, panel eski natijalarga qaytardi, talabalar esa "test yopilgan"ni ko'rardi.
      if (reused) {
        const remote = await fetchLiveTestSessionFromServer(reused).catch(() => null);
        if (remote?.isClosed) {
          clearStoredTeacherSid(testSession.topic);
          reused = null;
        }
      }
      await setupTeacherLiveSession(testSession, reused ?? undefined);
    } catch (err) {
      console.error('Live session start failed', err);
      setError(t(startSessionErrorKey(err)));
    } finally {
      setStartingSession(false);
    }
  };

  /** Bazadagi saqlangan variantni butunlay o'chirish. */
  const handleDeleteVersion = (id: string) => {
    if (!window.confirm(t('toolbar.deleteConfirm'))) return;
    void (async () => {
      try {
        await deletePreparedContent('test', id);
        if (activeVersionId === id) {
          setTestSession(null);
          setActiveVersionId(null);
        }
        // O'chirilgan yozuv ro'yxat yangilanmasa ham ko'rinmasin.
        setVersions((list) => list.filter((x) => x.id !== id));
        applyVersionsResult(await listPreparedForTopicResult('test', globalTopic ?? topic));
      } catch (err) {
        console.error('Delete version failed', err);
        setError(t('toolbar.deleteFailed'));
      }
    })();
  };

  /** Fon tarjimasi/manbalar tayyor bo'lmadi yoki Bazaga yozilmadi — test asosiy
   *  tilda saqlangan; boshqa til tanlanganda tarjima serverdan qayta so'raladi. */
  const notifyTranslationsNotSaved = () => {
    pushAppNotification({
      title: t('common.warningTitle'),
      body: t('test.translationsNotSaved'),
      titleKey: 'common.warningTitle',
      bodyKey: 'test.translationsNotSaved',
      level: 'warning',
    });
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!topic.trim() || generatingKey !== null) return;

    // Test fanga bog'lanishi shart — fan/mavzu tanlanmagan bo'lsa yaratishga yo'l qo'ymaymiz
    if (!globalTopic?.subjectCode?.trim()) {
      setError(t('test.errorNoSubject'));
      return;
    }

    if (testSession && teacherSessionId && !sessionClosed) {
      const ok = window.confirm(t('test.regenerateConfirm'));
      if (!ok) return;
    }

    // Generatsiya boshlangan mavzu konteksti qotiriladi.
    const startKey = topicKey;
    const startTopic = topic;
    const startContext = globalTopic;
    const subjectCode = startContext.subjectCode;
    const meta = buildPreparedContentMeta(startContext);
    const stillHere = () => topicKeyRef.current === startKey;

    setGeneratingKey(startKey);
    setError(null);
    const enrichToken = Symbol('test-enrich');
    enrichTokenRef.current = enrichToken;
    try {
      // Asosiy til = UI tili (header dagi uz/ru/en). Qolgan 2 til — fonda tarjima.
      const contentLanguage = contentLanguageFor(startContext, language);
      const lectureText = await loadLatestLectureText(startContext ?? startTopic);
      const scope = await hydrateGenerationScope({
        topic: startTopic,
        context: startContext,
        lectureText,
      });
      // 2026-10-21: 4 qiyin / 4 o'rta / 2 oson, o'tilgan mavzular bilan bog'lash,
      // o'tilmagan mavzulardan savol yo'q; savollar avval zaxiradan (AI'siz).
      // Izoh qisqa: pastda fonda `enrichTestSession` to'liq tahlil yozadi.
      // AI'ga mavzu nomi material TILIDA (2026-11-12): aks holda ruscha matn o'zbekcha sarlavha bilan chiqardi.
      const promptTopic = await topicTitleFor(startContext?.syllabusId, startTopic, contentLanguage);
      // Claude banki shu mavzuga hozir yozilayotgan bo'lsa — OpenAI'ni chaqirmay bank tayyor bo'lishini kutamiz
      // (2026-11-20). Bank to'lsa `composeTest` uni AI'siz yig'adi; vaqt tugasa — eski usul.
      if (startContext?.syllabusId && startContext.id) {
        const poolCtx = { syllabusId: startContext.syllabusId, topicCode: String(startContext.id), variantLabel: startContext.variantLabel };
        let pool = await fetchQuestionPool(poolCtx, contentLanguage);
        const until = pool?.bank_pending_until ? Date.parse(pool.bank_pending_until) : 0;
        if (until && until > Date.now()) {
          setBankWaitUntil(until);
          try {
            while (Date.now() < until && stillHere()) {
              await new Promise((r) => setTimeout(r, 20000));
              pool = await fetchQuestionPool(poolCtx, contentLanguage);
              if (!pool?.bank_pending_until) break;
            }
          } finally {
            setBankWaitUntil(null);
          }
          if (!stillHere()) return;
        }
      }
      const data = await aiService.composeTest({
        topic: promptTopic,
        language: contentLanguage,
        subjectCode,
        scope,
        context: startContext?.syllabusId && startContext.id
          ? { syllabusId: startContext.syllabusId, topicCode: String(startContext.id), variantLabel: startContext.variantLabel }
          : null,
      });
      const here = stillHere();
      if (here) {
        // Jonli sessiya shu yerda emas — test bazaga yozilgandan KEYIN
        // o'zi ochiladi (pastda, 2026-10-16), sessiya qaysi versiyadan
        // boshlangani shunda aniq bo'ladi.
        if (teacherSessionId && !sessionClosed) clearStoredTeacherSid(startTopic);
        setTestSession(data);
        setViewLang(data.primaryLanguage || contentLanguage);
        setTeacherSessionId('');
        setJoinUrl('');
        setSubmissions([]);
        setSessionClosed(false);
        setClosedAtMs(null);
        setShowQuestions(true);
        setActiveVersionId(null);
      }
      setGeneratingKey(null);

      // Asosiy tildagi test DARHOL bazaga yoziladi. Avval saqlash faqat fon
      // "enrich" (tarjima + manbalar) tugagach bo'lardi — o'qituvchi shu orada
      // sahifadan chiqsa test Bazada umuman qolmasdi.
      let savedId: string | null = null;
      try {
        savedId = await savePreparedContent('test', startTopic, data, meta);
        if (stillHere()) {
          const firstRes = await listPreparedForTopicResult('test', startContext ?? startTopic);
          if (stillHere() && enrichTokenRef.current === enrichToken) {
            applyVersionsResult(firstRes);
            setActiveVersionId(savedId ?? firstRes.items[0]?.id ?? null);
          }
        } else {
          pushAppNotification({
            title: t('common.doneTitle'),
            body: t('common.readyOtherTopic', { title: startTopic }),
            titleKey: 'common.doneTitle',
            bodyKey: 'common.readyOtherTopic',
            bodyParams: { title: startTopic },
            topicSyllabusId: startContext?.syllabusId,
            level: 'success',
          });
        }
      } catch (saveErr) {
        console.error('Test save failed', saveErr);
        if (stillHere()) setError(t('common.saveFailedKeepWork'));
      }

      // QR darhol (2026-10-16). O'qituvchilar "test yaratdim, QR chiqmadi"
      // deb shikoyat qildi: 16-oktabr ertalab 102 ta test yaratilib, faqat
      // 39 ta jonli sessiya ochilgan edi — tugmani topishmagan. YANGI
      // yaratilgan test darsda ishlatish uchun, shuning uchun sessiya o'zi
      // ochiladi. Bazadan ochilgan eski versiya esa avvalgidek tugma bilan:
      // shunchaki ko'rish uchun ochilganda serverda sessiya paydo bo'lmasin.
      // O'qituvchi orada boshqa bo'limga o'tgan bo'lsa ham (2026-11-06) — sessiya fonda
      // ochiladi va mavzu sahifasiga qaytganda (yoki u allaqachon ochiq bo'lsa) QR chiqadi.
      if (data.questions?.length) {
        try {
          if (aliveRef.current && stillHere()) {
            const sid = await setupTeacherLiveSession(data);
            if (savedId) writeStoredSidVersion(sid, savedId);
          } else {
            await startLiveSessionInBackground(data, subjectCode, savedId);
          }
        } catch (err) {
          console.error('Live session auto-start failed', err);
          if (aliveRef.current && stillHere()) setError(t(startSessionErrorKey(err)));
        }
      }

      if (stillHere()) setEnriching(true);
      void (async () => {
        try {
          // Fonda: qolgan 2 tilga tarjima + kitob manbalari
          const enriched = await aiService.enrichTestSession(data, contentLanguage, subjectCode);
          // Bazada NUSXA ko'paymasligi uchun yangi yozuv emas, mavjudi yangilanadi.
          // Bu mavzu almashtirilgan bo'lsa ham bajariladi — test o'z mavzusiga yoziladi.
          // Faqat yozuv haqiqatan yo'q bo'lsa yangisi yaratiladi; tarmoq/server xatosida
          // yangi nusxa YARATILMAYDI (ilgari har uzilish Bazada takror test qoldirardi).
          const patch = savedId
            ? await patchPreparedContentPayload(savedId, enriched)
            : ({ status: 'not_found' } as const);
          if (patch.status === 'not_found') {
            savedId = await savePreparedContent('test', startTopic, enriched, meta);
          } else if (patch.status === 'failed') {
            console.warn('Test enrich patch failed — primary-language test kept', patch.error);
            notifyTranslationsNotSaved();
          }
          // Ekran faqat shu test hali ochiq bo'lsa yangilanadi.
          if (enrichTokenRef.current !== enrichToken || !stillHere()) return;
          setTestSession(enriched);
          // O'qituvchi orada jonli sessiyani boshlagan bo'lsa — savollar
          // matni (izohlar/tarjimalar) yangilanadi, LEKIN sessiya qayta
          // ochilmaydi va natijalar tozalanmaydi. Yopilgan sessiyaga tegilmaydi.
          const liveSid = teacherSessionIdRef.current;
          if (liveSid && !sessionClosedRef.current) {
            const localDoc = loadLocalSession(liveSid);
            const createdAt = localDoc?.createdAt ?? Date.now();
            saveLocalSession(liveSid, { topic: enriched.topic, questions: enriched.questions, createdAt });
            const livePayload = { topic: enriched.topic, questions: enriched.questions, createdAt, subjectCode };
            // Bir marta qisqa kutib qayta uriniladi; baribir yiqilsa — o'qituvchiga aytiladi:
            // ochiq sessiyadagi talabalar hali eski savol matnini ko'rmoqda.
            let synced = await syncLiveTestSessionToServer(liveSid, livePayload);
            if (!synced) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              synced = await syncLiveTestSessionToServer(liveSid, livePayload);
            }
            if (!synced) {
              pushAppNotification({
                title: t('common.warningTitle'),
                body: t('test.liveSyncFailed'),
                titleKey: 'common.warningTitle',
                bodyKey: 'test.liveSyncFailed',
                level: 'warning',
              });
            }
          }
        } catch (enrichErr) {
          console.warn('Test enrich failed — primary-language test already saved', enrichErr);
          // Ilgari faqat konsolga yozilardi — o'qituvchi tarjimalar yo'qligini bilmasdi.
          if (savedId) notifyTranslationsNotSaved();
        }
        if (enrichTokenRef.current !== enrichToken || !stillHere()) return;
        setEnriching(false);
        const nextRes = await listPreparedForTopicResult('test', startContext ?? startTopic);
        if (enrichTokenRef.current !== enrichToken || !stillHere()) return;
        applyVersionsResult(nextRes);
        setActiveVersionId(savedId ?? nextRes.items[0]?.id ?? null);
      })();
    } catch (err) {
      console.error('Test generation error:', err);
      if (stillHere()) {
        setError(
          err instanceof Error && err.message === TOO_FEW_QUESTIONS
            ? t('test.errorTooFewGenerated', { count: DEFAULT_TEST_QUESTION_COUNT })
            : messageFromAiError(err, t('test.errorGenerate'), language),
        );
      }
      setGeneratingKey(null);
    }
  };

  const handleStudentAnswer = (questionIndex: number, optionIndex: number) => {
    if (studentSubmitted) return;
    const prev = studentAnswers[questionIndex];
    if (studentSessionId) {
      pushLiveTestEvent(studentSessionId, {
        event_type: prev >= 0 && prev !== optionIndex ? 'answer_change' : 'answer_select',
        question_index: questionIndex,
        option_index: optionIndex,
      });
    }
    const next = [...studentAnswers];
    next[questionIndex] = optionIndex;
    setStudentAnswers(next);
    if (studentSessionId) saveLocalLiveTestAnswers(studentSessionId, next, studentOwnerKey());
    if (missingQuestion === questionIndex) setMissingQuestion(null);
  };

  /** Ball. Javoblar ro'yxati savollar ro'yxatidan uzunroq bo'lishi mumkin
   * (masalan test qayta yaratilgan bo'lsa) — `questions[i]` mavjudligi
   * tekshirilmasa sahifa butunlay yiqilardi. */
  const calculateScore = (answers: number[], questions: TestQuestion[]) => {
    return answers.filter((a, i) => {
      const q = questions[i];
      return q != null && a === q.correctOptionIndex;
    }).length;
  };

  const handleDownloadKeyPdf = async () => {
    if (!displayedTest || testStatus !== 'ready') return;
    setDownloadingKeyPdf(true);
    try {
      await downloadTestAnswerKeyPdf(displayedTest, viewLang);
    } catch (err) {
      console.error('Answer key PDF error:', err);
      setError(t('test.errorPdf'));
    } finally {
      setDownloadingKeyPdf(false);
    }
  };

  /**
   * Natijalar QAYSI savollar bo'yicha chiqariladi. Talabalar sessiyadagi
   * savollarga javob bergan; o'qituvchi ekranidagi test esa shu orada boshqa
   * versiya bo'lishi mumkin (Bazadan boshqasi ochilgan, qayta yaratilgan).
   * Ilgari PDF ekrandagi test bo'yicha har savolni belgilardi — jami ball
   * serverdan to'g'ri kelsa ham, "qaysi savolda adashdi" noto'g'ri chiqardi.
   */
  const resultsPdfSource = (): { session: TestSession; lang: AppLanguage } => {
    const onScreen =
      displayedTest && testStatus === 'ready'
        ? { session: displayedTest, lang: viewLang }
        : { session: testSession as TestSession, lang: language };
    const doc = teacherSessionId ? loadLocalSession(teacherSessionId) : null;
    const keyed =
      doc?.questions?.length &&
      doc.questions.every((q) => typeof (q as TestQuestion).correctOptionIndex === 'number');
    if (!doc || !keyed || !testSession) return onScreen;
    if (questionsFingerprint(doc.questions) === questionsFingerprint(testSession.questions)) return onScreen;
    return {
      session: { ...testSession, topic: doc.topic, questions: doc.questions as TestQuestion[] },
      lang: testSession.primaryLanguage || language,
    };
  };

  const handleDownloadResultsPdf = async () => {
    if (!testSession || submissions.length === 0) return;
    setDownloadingResultsPdf(true);
    try {
      const source = resultsPdfSource();
      // Savollar va sarlavha ekrandagi tilda (tarjima tayyor bo'lsa).
      await downloadTestResultsPdf(
        source.session,
        submissions.map((s) => ({
          firstName: s.firstName,
          lastName: s.lastName,
          answers: s.answers,
          submittedAt: s.submittedAt,
          correct: s.correct,
        })),
        source.lang,
      );
    } catch (err) {
      console.error('Results PDF error:', err);
      setError(t('test.errorPdf'));
    } finally {
      setDownloadingResultsPdf(false);
    }
  };

  /** Ikki rolli odam (o'qituvchi + talaba, 2026-10-28) test uchun talaba profiliga o'tadi. */
  const studentUser = async () => {
    let u = getCurrentLocalUser();
    if (normalizeUserRole(u) !== 'student' && choosableRoles().includes('student')) {
      try {
        u = await chooseSessionRole('student');
      } catch {
        /* quyida "faqat talaba" deb rad etiladi */
      }
    }
    return u && normalizeUserRole(u) === 'student' ? u : null;
  };

  /** JSHSHIR yoki pasport bilan kirgach — ism-familiya hisobdan olinadi. */
  const handleStudentIdLogin = async () => {
    const u = await studentUser();
    if (!u) {
      setError(t('test.studentLoginForbidden'));
      return;
    }
    setError(null);
    // Raqamni kim yozganini server bilmaydi: Talaba ID'da bitta raqam xato bo'lsa boshqa
    // talabaning hisobi ochilardi (2026-11-02: 12 xonali ID'lari bir raqamga farq qiladigan
    // ikki talaba, biri ikkinchisining nomidan 3 ta test topshirgan). Endi ism ko'rsatib so'raladi.
    setIdentityFrom('id');
    setSavedStudent(u);
  };

  /** "Ha, bu men" — telefonda saqlangan hisob bilan davom etadi. */
  const confirmSavedStudent = () => {
    if (!savedStudent) return;
    rememberConfirmedStudent(studentSessionId, savedStudent.uid);
    setSavedStudent(null);
    setStudentAuthed(true);
    void getBackendAccessToken();
  };

  /** "Men boshqa talabaman" — oldingi talaba shu telefondan chiqariladi, o'zi kiradi. */
  const switchStudent = () => {
    clearBackendAuthTokens();
    logoutLocalStaff();
    setSavedStudent(null);
    setStudentFirstName('');
    setStudentLastName('');
    // Raqam bilan kirgan bo'lsa — raqamni tuzatib qayta yozsin; telefonda qolgan hisob bo'lsa — yuz.
    setStudentLoginMode(identityFrom === 'id' ? 'id' : 'face');
    setIdentityFrom('saved');
  };

  const handleStudentFaceLogin = async () => {
    const u = await studentUser();
    if (!u) {
      // Yuz xodimniki chiqdi — test talaba uchun; JSHSHIR/pasport bilan kirsin.
      setStudentLoginMode('id');
      setError(t('test.studentLoginForbidden'));
      return;
    }
    setError(null);
    rememberConfirmedStudent(studentSessionId, u.uid);
    setStudentFirstName(u.firstName || '');
    setStudentLastName(u.lastName || '');
    setStudentAuthed(true);
    await getBackendAccessToken();
  };

  useEffect(() => {
    if (!isStudentMode || !studentAuthed) return;
    const u = getCurrentLocalUser();
    if (normalizeUserRole(u) !== 'student' || !u) return;
    if (!studentFirstName.trim() && u.firstName) setStudentFirstName(u.firstName);
    if (!studentLastName.trim() && u.lastName) setStudentLastName(u.lastName);
  }, [isStudentMode, studentAuthed, studentFirstName, studentLastName]);

  // Topshirgan (yoki test yopilgan) talaba sahifadan ketmaydi: natija va tahlil
  // o'qituvchi "Testni tahlil qilish"ni bosganda shu yerda chiqadi (2026-10-21).
  // Ilgari 2 soniyada "Mening testlarim"ga o'tib, balni darhol ko'rsatardi.
  useEffect(() => {
    if (!isStudentMode || !studentSessionId || !studentAuthed) return;
    if (!studentSubmitted && !sessionClosed) return;
    if (myResult?.ready) return;
    let stopped = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const result = await fetchMyLiveTestResult(studentSessionId);
        if (!stopped && result) setMyResult(result);
      } catch {
        /* keyingi urinishda */
      }
    };
    void poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [isStudentMode, studentSessionId, studentAuthed, studentSubmitted, sessionClosed, myResult?.ready]);

  /**
   * `timeUp` — vaqt tugadi (2026-10-22): belgilangan javoblar o'zi topshiriladi,
   * belgilanmagani xato hisoblanadi. Server ham faqat vaqt ichida saqlanganini oladi.
   */
  const handleStudentSubmit = async (timeUp = false): Promise<boolean> => {
    if (!studentTest || !studentSessionId) return true;
    if (!studentAuthed) {
      setError(t('test.studentLoginRequired'));
      return true;
    }
    if (!timeUp && (!studentFirstName.trim() || !studentLastName.trim())) {
      setError(t('test.studentErrorName'));
      return true;
    }
    if (!timeUp && studentAnswers.includes(-1)) {
      // Qaysi savol qolganini talaba o'zi qidirmasin: o'sha savolga olib boriladi
      // (raqami talaba ko'rgan tartib bo'yicha).
      const shown = (studentView?.questions ?? studentAnswers.map((_, i) => i)).findIndex((qi) => studentAnswers[qi] === -1);
      const first = studentView?.questions[shown] ?? studentAnswers.indexOf(-1);
      setMissingQuestion(first);
      setError(`${t('test.studentErrorAllQuestions')} (${shown + 1})`);
      document.getElementById(`student-question-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    setStudentLoading(true);
    setError(null);
    try {
      // Kuzatuv hodisalari kutilmaydi: sekin internetda ular javoblarni
      // yuborishni 15 soniyagacha ushlab turardi.
      void flushLiveTestEvents(studentSessionId, participantKeyRef.current).catch(() => undefined);
      const started = testStartedAtRef.current ?? Date.now();
      await submitLiveTestOnServer(studentSessionId, {
        participantKey: participantKeyRef.current,
        firstName: studentFirstName.trim(),
        lastName: studentLastName.trim(),
        answers: studentAnswers,
        started_at_ms: started,
        duration_sec: Math.max(0, Math.round((Date.now() - started) / 1000)),
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
      clearLocalLiveTestAnswers(studentSessionId, studentOwnerKey());
      setStudentSubmitted(true);
      if (timeUp) setTimeUpSubmitted(true);
      return true;
    } catch (err) {
      console.error(err);
      if (err instanceof HttpError && err.status === 403) {
        // O'qituvchi testni yopib bo'lgan — "internetni tekshiring" emas.
        setSessionClosed(true);
        setError(t('test.sessionClosedStudentHint'));
        return true;
      }
      setError(t('test.studentErrorSubmit'));
      return false;
    } finally {
      setStudentLoading(false);
    }
  };

  // Sinfdagi katta ekran: QR ko'rsatilib, talabalar test yechayotgan paytda
  // to'g'ri javob, variant izohlari va tahlil ko'rinmasligi kerak (2026-10-09:
  // monitorda javoblari ochiq test rasmi kelgan). Sessiya yakunlangach — ochiq.
  // 2026-10-21: o'qituvchi "Testni tahlil qilish"ni bosmaguncha javoblar ekranda
  // ham ko'rinmaydi ("ko'rsatish" tugmasi olib tashlandi).
  const sessionRunning = Boolean(teacherSessionId) && !sessionClosed;
  const hideAnswers = sessionRunning;
  const progress = useMemo(() => {
    const submitted = submissions.filter((s) => s.status !== 'in_progress').length;
    return { joined: submissions.length, submitted, answering: submissions.length - submitted };
  }, [submissions]);
  // Tahlil: har savolga nechta talaba qaysi variantni tanlagan (faqat yopilgandan keyin).
  const questionStats = useMemo(() => {
    if (!sessionClosed || !testSession) return [];
    return testSession.questions.map((q, i) => {
      const counts = q.options.map(() => 0);
      let blank = 0;
      for (const s of submissions) {
        const a = s.answers?.[i];
        if (typeof a === 'number' && a >= 0 && a < counts.length) counts[a] += 1;
        else blank += 1;
      }
      const ok = counts[q.correctOptionIndex] ?? 0;
      const n = submissions.length;
      return { counts, blank, ok, n, pct: n ? Math.round((ok / n) * 100) : 0 };
    });
  }, [sessionClosed, testSession, submissions]);

  // Har talabaga o'z tartibi (2026-10-22): savollar va variantlar aralashtiriladi,
  // javob esa asl raqam bilan saqlanadi.
  const studentView = useMemo(
    () =>
      isStudentMode && studentTest && studentSessionId
        ? studentOrder(studentSessionId, studentOwnerKey(), studentTest.questions.map((q) => q.options.length))
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStudentMode, studentTest, studentSessionId, studentAuthed],
  );
  const timerRunning = isStudentMode && deadlineMs !== null && !studentSubmitted && !sessionClosed;
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);
  const msLeft = deadlineMs !== null ? deadlineMs - (clockNow + clockOffsetRef.current) : null;
  const timeUp = msLeft !== null && msLeft <= 0;
  useEffect(() => {
    if (!timerRunning || !timeUp || studentLoading || autoSubmitRef.current) return;
    autoSubmitRef.current = true;
    void handleStudentSubmit(true).then((ok) => {
      // Yuborilmadi (server yoki internet) — 10 soniyadan keyin yana. Ilgari bir marta
      // urinib to'xtardi va talabaning javobi faqat o'qituvchi tahlil bosganda yetib borardi.
      if (!ok) window.setTimeout(() => { autoSubmitRef.current = false; setAutoSubmitRetry((n) => n + 1); }, 10000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning, timeUp, studentLoading, autoSubmitRetry]);

  // Hook shartli `return`dan OLDIN chaqiriladi (React hook qoidasi).
  const staffTopic = useLocalizedTopic(
    globalTopic && isTopicContextComplete(globalTopic) ? globalTopic : null,
  );

  const ts = useTranslate(studentTestLang ?? language);
  // Monitor rejimida test tugagach natija kutiladi (o'qituvchi tahlil qilgach `my-result` chiqadi).
  const markMonitorDone = useCallback(() => setStudentSubmitted(true), []);

  if (isStudentMode) {
    return (
      <div className="h-full flex flex-col bg-[#f2f2f7] p-3 sm:p-5 lg:p-6 overflow-y-auto">
        <div className="w-full space-y-6 pb-20">
          <div className="text-center space-y-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 sm:text-[24px]">{ts('test.studentTitle')}</h1>
            {/* Avval har doim (login bosqichida ham) "ism-familiyangizni kiriting"
                degan matn ko'rsatilardi — aslida bu bosqichda login talab
                qilinadi, ism-familiya keyingi qadamda so'raladi. Matn holatga
                mos bo'lishi uchun shartli qilindi. */}
            {!savedStudent && (
              <p className="text-slate-400">
                {studentAuthed ? ts('test.studentSubtitle') : ts('test.studentLoginHint')}
              </p>
            )}
          </div>
          {savedStudent ? (
            <div
              data-testid="student-identity"
              className="mx-auto w-full max-w-md space-y-5 rounded-2xl bg-white p-6 text-center ring-1 ring-slate-900/[0.06] sm:p-8"
            >
              <UserCheck size={36} className="mx-auto text-blue-600" />
              <div className="space-y-1">
                <p className="text-[15px] font-medium text-slate-500">{ts('test.identityQuestion')}</p>
                <p className="text-[20px] font-semibold tracking-tight text-slate-900">
                  {[savedStudent.lastName, savedStudent.firstName].filter(Boolean).join(' ') || savedStudent.displayName}
                </p>
              </div>
              <p className="text-[13px] leading-relaxed text-slate-500">{ts(identityFrom === 'id' ? 'test.identityHintId' : 'test.identityHint')}</p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={confirmSavedStudent}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-[15px] font-semibold text-white hover:bg-blue-700"
                >
                  {ts('test.identityYes')}
                </button>
                <button
                  type="button"
                  onClick={switchStudent}
                  className="w-full rounded-xl bg-slate-100 px-4 py-3 text-[15px] font-semibold text-slate-800 hover:bg-slate-200"
                >
                  {ts('test.identityNo')}
                </button>
              </div>
            </div>
          ) : !studentAuthed && studentLoginMode === 'face' ? (
            <div className="rounded-2xl bg-white px-4 py-6 ring-1 ring-slate-900/[0.06] sm:px-8">
              <FaceLogin
                onUsePassword={() => setStudentLoginMode('id')}
                onLoggedIn={() => void handleStudentFaceLogin()}
              />
            </div>
          ) : !studentAuthed ? (
            <div className="mx-auto w-full max-w-md space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-900/[0.06] sm:p-8">
              <div className="flex items-center gap-2 font-semibold text-blue-700">
                <KeyRound size={20} />
                {ts('test.studentLoginTitle')}
              </div>
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {/* Talaba ham xodim kabi parolsiz kiradi (2026-10-02). */}
              <IdLogin
                onUseFace={() => {
                  setError(null);
                  setStudentLoginMode('face');
                }}
                onDone={() => void handleStudentIdLogin()}
              />
            </div>
          ) : sessionLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="animate-spin text-blue-600 mx-auto mb-3" />
              <p className="text-slate-600">{ts('test.studentLoading')}</p>
            </div>
          ) : myResult?.ready ? (
            // Natija tayyor (o'qituvchi tahlil qildi) — test yopilgan bo'lsa ham shu ko'rinadi.
            <StudentResult result={myResult} />
          ) : error && !studentTest ? (
            <div className="rounded-xl bg-rose-50 px-5 py-4 text-center text-[13.5px] font-medium text-rose-700">
              {error}
            </div>
          ) : sessionClosed ? (
            <div className="space-y-3 rounded-xl bg-amber-50 px-5 py-6 text-center text-amber-900">
              <Lock size={32} className="mx-auto text-amber-700" />
              <p className="font-bold text-lg">{ts('test.sessionClosedStudent')}</p>
              <p className="text-sm text-amber-800/80">{ts('test.studentWaitResult')}</p>
            </div>
          ) : studentMonitor && studentTest ? (
            <StudentMonitorRunner
              sessionKey={studentSessionId}
              participantKey={getLiveTestParticipantKey(studentSessionId, studentOwnerKey())}
              firstName={studentFirstName}
              lastName={studentLastName}
              lang={studentTestLang ?? language}
              topic={studentTopicDisplay || studentTest.topic}
              onDone={markMonitorDone}
            />
          ) : studentTest ? (
            <>
              <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
                <h2 className="mb-4 text-[17px] font-semibold tracking-tight text-slate-900">{studentTopicDisplay || studentTest.topic}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={studentFirstName}
                    onChange={(e) => setStudentFirstName(e.target.value)}
                    placeholder={ts('test.studentFirstName')}
                    disabled={studentSubmitted || sessionClosed}
                    className={staffInput}
                  />
                  <input
                    value={studentLastName}
                    onChange={(e) => setStudentLastName(e.target.value)}
                    placeholder={ts('test.studentLastName')}
                    disabled={studentSubmitted || sessionClosed}
                    className={staffInput}
                  />
                </div>
              </div>

              {msLeft !== null && !studentSubmitted && (
                <div
                  data-testid="student-timer"
                  className={`sticky top-0 z-10 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] font-semibold shadow-sm ring-1 ${
                    msLeft <= 2 * 60 * 1000 ? 'bg-rose-50 text-rose-800 ring-rose-200' : 'bg-white text-slate-800 ring-slate-900/[0.08]'
                  }`}
                >
                  <span>{ts('test.timeLeft')}</span>
                  <span className="text-[20px] tabular-nums">{formatClock(msLeft)}</span>
                </div>
              )}
              {draftSaveFailed && !studentSubmitted && !sessionClosed && (
                <p
                  role="status"
                  data-testid="student-draft-retrying"
                  className="flex items-center justify-center gap-1.5 text-center text-[12.5px] font-medium text-amber-700"
                >
                  <Loader2 size={13} className="animate-spin" />
                  {ts('test.answerSaveRetrying')}
                </p>
              )}
              {!studentSubmitted && !sessionClosed && studentTest.questions.length > 0 && timeLimitSec !== 0 && (
                <p className="text-center text-[12.5px] text-slate-500">
                  {ts('test.timeLimitHint', {
                    minutes: String(Math.round((timeLimitSec ?? studentTest.questions.length * 90) / 60)),
                  })}
                </p>
              )}
              {/* Matnni belgilash, nusxalash va uzoq bosish menyusi o'chirilgan (2026-10-22):
                  savolni boshqa ilovaga ko'chirib javob qidirish qiyinlashsin. */}
              <div
                className="space-y-6 select-none"
                style={{ WebkitTouchCallout: 'none' }}
                onCopy={(e) => e.preventDefault()}
                onCut={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Talaba ko'rinishi ham o'qituvchinikidek: raqam nishoni,
                    qalin savol matni, bir xil variant o'lchamlari. */}
                {(studentView?.questions ?? studentTest.questions.map((_, k) => k)).map((qi, shown) => {
                  const q = studentTest.questions[qi];
                  if (!q) return null;
                  const optionOrder = studentView?.options[qi] ?? q.options.map((_, k) => k);
                  const labels = stripOptionLabels(q.options);
                  return (
                  <div
                    key={qi}
                    id={`student-question-${qi}`}
                    className={`space-y-4 rounded-2xl bg-white p-5 ring-1 sm:p-6 ${missingQuestion === qi ? 'ring-2 ring-rose-400' : 'ring-slate-900/[0.06]'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={staffIndexBadge}>{shown + 1}</div>
                      <p className={staffQuestionText}>{q.question}</p>
                    </div>
                    <div className="space-y-2">
                      {optionOrder.map((optIdx, place) => (
                        <button
                          key={optIdx}
                          onClick={() => handleStudentAnswer(qi, optIdx)}
                          disabled={studentSubmitted || sessionClosed || timeUp}
                          className={`w-full text-left text-[14px] leading-relaxed p-3 rounded-xl border transition-colors ${
                            studentAnswers[qi] === optIdx
                              ? 'border-blue-500 bg-blue-50 text-blue-900 font-semibold'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                          }`}
                        >
                          <span className="font-bold">{String.fromCharCode(65 + place)})</span>{' '}
                          {labels[optIdx]}
                        </button>
                      ))}
                    </div>
                  </div>
                  );
                })}
              </div>

              {!studentSubmitted && !sessionClosed && (
                <p className="text-center text-[13px] font-medium text-slate-500" data-testid="student-progress">
                  {countAnswered(studentAnswers)} / {studentTest.questions.length}
                </p>
              )}
              {!studentSubmitted && !sessionClosed ? (
                <button
                  onClick={() => void handleStudentSubmit(timeUp)}
                  disabled={studentLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 bg-slate-900 text-white hover:bg-slate-700 h-12 w-full text-[14px]"
                >
                  {studentLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {ts('test.studentSubmit')}
                </button>
              ) : studentSubmitted ? (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-xl space-y-3">
                  <p className="font-semibold">{timeUpSubmitted ? ts('test.timeUpSubmitted') : ts('test.studentSuccess')}</p>
                  <p className="flex items-center gap-2 text-[13px] text-emerald-800/85">
                    <Loader2 size={15} className="animate-spin shrink-0" />
                    {ts('test.studentWaitResult')}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = `${window.location.pathname}?view=my-tests`;
                    }}
                    className="w-full h-11 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-500"
                  >
                    {ts('student.myTestsTitle')}
                  </button>
                </div>
              ) : null}
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
    <StaffPageLayout
      title={t('nav.tests')}
      icon={ClipboardList}
      accent="emerald"
       spacious
    >
      <ContentTopicToolbar
        moduleLabel={t('test.teacherBadge', { count: DEFAULT_TEST_QUESTION_COUNT })}
        topic={staffTopic}
        topicValue={topic}
        onTopicChange={setTopic}
        topicLabel={t('test.topicLabel')}
        topicPlaceholder={t('test.topicPlaceholder')}
        createLabel={t('test.create', { count: DEFAULT_TEST_QUESTION_COUNT })}
        loading={loading || busyElsewhere}
        onCreate={() => void handleGenerate()}
        lockTopicFromSyllabus={Boolean(staffTopic)}
        hint={`${t('test.heroSubtitle')} ${t(
          generationDomain === 'academic'
            ? 'test.modeAcademic'
            : generationDomain === 'biomedical'
              ? 'test.modeBiomedical'
              : 'test.modeClinical',
        )}`}
        versions={versions}
        versionsLoadFailed={versionsLoadFailed}
        onRetryVersions={refreshVersions}
        activeVersionId={activeVersionId}
        onSelectVersion={handleSelectVersion}
        onDeleteVersion={handleDeleteVersion}
        versionsTitle={t('test.savedVersions')}
        hasUnsavedActiveContent={Boolean(testSession)}
      />

      {busyElsewhere && (
        <p className="text-[12.5px] font-medium text-slate-500">{t('common.busyOtherTopic')}</p>
      )}
      {error && <StaffErrorAlert message={error} />}
      {loading && bankWaitUntil && (
        <p className="rounded-xl bg-sky-50 px-4 py-3 text-[13px] font-medium text-sky-800 ring-1 ring-sky-200">
          {t('test.bankWaiting', { min: Math.max(1, Math.ceil((bankWaitUntil - Date.now()) / 60000)) })}
        </p>
      )}
      {loading && (
        <StaffLoading
          label={t('test.generating')}
          hint={t('test.generatingHint', {
            count: DEFAULT_TEST_QUESTION_COUNT,
            level: t('test.difficultyHard'),
          })}
        />
      )}

        {testSession && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <StaffPanel className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                {/* Sarlavha interfeys tilida — sessiyada asl (o'zbekcha) matn turadi. */}
                <h2 className={`text-xl font-bold ${STAFF_HEADING}`}>
                  {staffTopic?.translating
                    ? t('common.translating')
                    : staffTopic && staffTopic.title
                    ? staffTopic.title
                    : displayedTest?.topic || testSession.topic}
                </h2>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {availableTestLangs.length > 1 && (
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                      {availableTestLangs.map((l) => (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={viewLang === l}
                          onClick={() => setViewLang(l)}
                          className={`px-3 py-1.5 text-xs font-semibold uppercase ${
                            viewLang === l ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  )}
                  <StaffToolbarButton
                    onClick={() => void handleDownloadKeyPdf()}
                    disabled={downloadingKeyPdf || testStatus !== 'ready' || sessionRunning}
                  >
                    {downloadingKeyPdf ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                    {t('test.downloadKeyPdf')}
                  </StaffToolbarButton>
                  <StaffToolbarButton
                    onClick={() => void handleDownloadResultsPdf()}
                    disabled={downloadingResultsPdf || submissions.length === 0 || !sessionClosed}
                  >
                    {downloadingResultsPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    {t('test.downloadResultsPdf')} ({submissions.length})
                  </StaffToolbarButton>
                </div>
              </div>

              {sessionClosed && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                  <Lock size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{t('test.sessionClosedTeacher')}</p>
                    <p className="text-sm text-amber-800/85 mt-1">{t('test.sessionClosedTeacherHint')}</p>
                  </div>
                </div>
              )}

              {/* Monitor rejimi (2026-11-12): kutish (QR + "Tayyorman") → savol monitorda, telefonda variantlar → tahlil.
                  Eski (monitorsiz) sessiya bo'lsa — avvalgi QR va jarayon paneli (`fallback`). */}
              {joinUrl && !sessionClosed && teacherSessionId && (
                <LiveMonitorHost
                  sessionKey={teacherSessionId}
                  finalizing={finalizing}
                  onAnalyze={() => void handleFinalizeSession(true)}
                  qr={(
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
                  <div className="lg:col-span-1 flex justify-center">
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.08]">
                      {joinQrDataUrl ? (
                        <img
                          src={joinQrDataUrl}
                          alt="Student test QR"
                          onError={() => { setJoinQrDataUrl(''); setQrRenderFailed(true); }}
                          className="w-72 h-72 sm:w-80 sm:h-80 object-contain"
                        />
                      ) : (
                        <div className="w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center text-sm text-slate-400">
                          {qrRenderFailed ? t('test.qrRenderFailed') : 'QR…'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="lg:col-span-2 space-y-3">
                    <p className="text-sm text-slate-600">
                      {t('test.qrInstructions')}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={joinUrl}
                        readOnly
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          // http:// da `navigator.clipboard` yo'q — zaxira usul bilan.
                          const ok = await copyTextToClipboard(joinUrl);
                          if (!ok) setError(t('common.copyFailed'));
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 bg-slate-900 text-white hover:bg-slate-700 px-4 py-2 text-[13.5px]"
                      >
                        <Copy size={16} /> {t('common.link')}
                      </button>
                    </div>
                  </div>
                </div>
                  )}
                  fallback={(
                    <>
              {joinUrl && !sessionClosed && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
                  <div className="lg:col-span-1 flex justify-center">
                    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.08]">
                      {joinQrDataUrl ? (
                        <img
                          src={joinQrDataUrl}
                          alt="Student test QR"
                          onError={() => { setJoinQrDataUrl(''); setQrRenderFailed(true); }}
                          className="w-72 h-72 sm:w-80 sm:h-80 object-contain"
                        />
                      ) : (
                        <div className="w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center text-sm text-slate-400">
                          {qrRenderFailed ? t('test.qrRenderFailed') : 'QR…'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="lg:col-span-2 space-y-3">
                    <p className="text-sm text-slate-600">
                      {t('test.qrInstructions')}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={joinUrl}
                        readOnly
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          // http:// da `navigator.clipboard` yo'q — zaxira usul bilan.
                          const ok = await copyTextToClipboard(joinUrl);
                          if (!ok) setError(t('common.copyFailed'));
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 bg-slate-900 text-white hover:bg-slate-700 px-4 py-2 text-[13.5px]"
                      >
                        <Copy size={16} /> {t('common.link')}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {sessionRunning && (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4" data-testid="live-progress">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 text-[13px] font-semibold">
                      <span className="rounded-lg bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">
                        {t('test.progressJoined', { count: String(progress.joined) })}
                      </span>
                      <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-800 ring-1 ring-emerald-200">
                        {t('test.progressSubmitted', { count: String(progress.submitted) })}
                      </span>
                      <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-800 ring-1 ring-amber-200">
                        {t('test.progressAnswering', { count: String(progress.answering) })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleFinalizeSession()}
                      disabled={finalizing}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-[14px] font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {finalizing ? <Loader2 size={17} className="animate-spin" /> : <Brain size={17} />}
                      {t('test.analyzeTest')}
                    </button>
                  </div>
                  <p className="text-[12.5px] text-slate-500">{t('test.progressHint')}</p>
                  {submissions.length > 0 && (
                    <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {submissions.map((s, idx) => (
                        <li
                          key={`${s.firstName}-${s.lastName}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[13px] ring-1 ring-slate-200"
                        >
                          <span className="truncate font-medium text-slate-800">{s.firstName} {s.lastName}</span>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${
                              s.status === 'in_progress'
                                ? 'bg-amber-50 text-amber-800'
                                : s.status === 'time_over'
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {s.status === 'in_progress'
                              ? `${s.answered ?? 0}/${s.total ?? testSession.questions.length}` +
                                (typeof s.secondsLeft === 'number' ? ` · ${formatClock(s.secondsLeft * 1000)}` : '')
                              : s.status === 'time_over'
                                ? `${t('test.progressTimeOver')} · ${s.answered ?? 0}/${s.total ?? testSession.questions.length}`
                                : t('test.progressDone')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

                    </>
                  )}
                />
              )}
              {!teacherSessionId && !sessionClosed && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                  <p className="flex-1 min-w-[12rem] text-sm text-blue-900/80">
                    {t('test.startLiveSessionHint')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleStartLiveSession()}
                    disabled={startingSession}
                    className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 bg-slate-900 text-white hover:bg-slate-700 shrink-0 px-4 py-2 text-[13.5px]"
                  >
                    {startingSession ? (
                      <Loader2 size={16} className="inline mr-1 animate-spin" />
                    ) : (
                      <Users size={16} className="inline mr-1" />
                    )}
                    {t('test.startLiveSession')}
                  </button>
                </div>
              )}

              {sessionClosed && teacherSessionId && (
                <div className="flex gap-2 flex-wrap">
                  {[
                    { on: !showQuestions, label: t('test.tabResults'), icon: <Users size={16} className="inline mr-1" />, pick: () => setShowQuestions(false) },
                    { on: showQuestions, label: t('test.tabAnalysis'), icon: <Brain size={16} className="inline mr-1" />, pick: () => setShowQuestions(true) },
                  ].map((tab) => (
                    <button
                      key={tab.label}
                      type="button"
                      onClick={tab.pick}
                      className={`rounded-lg px-4 py-2 text-[13.5px] font-semibold transition-colors ${tab.on ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-900/[0.08] hover:text-slate-900'}`}
                    >
                      {tab.icon}
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </StaffPanel>

            {!showQuestions && teacherSessionId && sessionClosed ? (
              <StaffPanel className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-900/[0.07] px-4 py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <button type="button" onClick={handleBackToQuestions} className={staffBtnGhost}>
                      <ArrowLeft size={16} />
                      {t('test.backToQuestions')}
                    </button>
                    <span className={`text-[14px] font-bold ${STAFF_HEADING}`}>
                      {t('test.resultsTitle')} ({submissions.length})
                    </span>
                    {submissions.some((row) => row.flags?.length) && (
                      <span className="rounded-lg bg-rose-50 px-2.5 py-1 text-[12.5px] font-semibold text-rose-700 ring-1 ring-rose-200">
                        {t('test.suspicious', { count: String(submissions.filter((row) => row.flags?.length).length) })}
                      </span>
                    )}
                    {submissions.length > 0 && (
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] font-semibold text-slate-700">
                        {t('test.avgScore')}:{' '}
                        {Math.round(
                          (submissions.reduce((a, row) => {
                            const total = row.total ?? testSession.questions.length;
                            const score = row.correct ?? calculateScore(row.answers, testSession.questions);
                            return a + (total ? score / total : 0);
                          }, 0) * 100) / submissions.length,
                        )}
                        %
                      </span>
                    )}
                  </div>
                  {sessionClosed && (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                      {t('test.sessionFinalized')}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-900/[0.07] text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                        <th className="px-4 py-3">{t('test.studentColumn')}</th>
                        <th className="px-4 py-3">{t('test.scoreColumn')}</th>
                        <th className="px-4 py-3">{t('test.gradeColumn')}</th>
                        <th className="px-4 py-3">{t('test.behaviourColumn')}</th>
                        <th className="px-4 py-3">{t('test.timeColumn')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s, idx) => {
                        const score = s.correct ?? calculateScore(s.answers, testSession.questions);
                        const total = s.total ?? testSession.questions.length;
                        const grade = scoreToGrade(score, total);
                        return (
                        <tr key={idx} className="border-b border-slate-900/[0.05] last:border-b-0">
                          <td className="px-4 py-3 font-semibold text-slate-900">{s.firstName} {s.lastName}</td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-slate-700">
                            {score} / {total}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center justify-center min-w-[2rem] px-2.5 py-1 rounded-lg border text-sm font-bold ${gradeBadgeClass(grade)}`}>
                              {grade}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1 text-[11.5px] font-semibold">
                              {s.durationSec ? (
                                <span className={`rounded-md px-2 py-0.5 ${s.flags?.includes('fast') ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {t('test.durationLabel', { time: formatClock(s.durationSec * 1000) })}
                                </span>
                              ) : null}
                              {s.awayCount ? (
                                <span className={`rounded-md px-2 py-0.5 ${s.flags?.includes('left_app') ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {t('test.flagLeftApp', { count: String(s.awayCount), seconds: String(s.awaySec ?? 0) })}
                                </span>
                              ) : null}
                              {s.flags?.includes('same_answers') && (
                                <span className="rounded-md bg-rose-50 px-2 py-0.5 text-rose-700">
                                  {t('test.flagSame', { names: (s.sameAs || []).join(', ') })}
                                </span>
                              )}
                              {s.flags?.includes('no_timer') && (
                                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-800">{t('test.flagNoTimer')}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-400 tabular-nums">
                            {new Date(s.submittedAt).toLocaleString(locale)}
                          </td>
                        </tr>
                        );
                      })}
                      {submissions.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                            {t('test.noSubmissionsRow')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </StaffPanel>
            ) : sessionRunning ? (
              // Monitor rejimi (2026-11-12): test ochiq paytida savollar ro'yxati ko'rsatilmaydi —
              // monitorda talabalar keyingi savollarni oldindan o'qib olmasin. Tahlildan keyin qaytadi.
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-500 ring-1 ring-slate-200" data-testid="questions-hidden">
                {t('monitor.host.questionsHidden')}
              </p>
            ) : (
              <div className="space-y-6">
                {enriching && (
                  <div className="flex items-center gap-2.5 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-[13px] text-blue-900">
                    <Loader2 size={16} className="animate-spin shrink-0" />
                    <span>{t('test.enriching')}</span>
                  </div>
                )}
                {/* Kartochka Keys/Ma'ruza bo'limlari bilan bir xil `StaffPanel` —
                    ilgari bu yerda o'ziga xos oq `rounded-3xl` kartochkalar bo'lib,
                    Test bo'limi boshqa ilovadek ko'rinardi. */}
                <TranslationGate status={testStatus} onRetry={retryTestTranslation}>
                <TranslationReviewBar
                  payload={testSession}
                  versionId={enriching ? null : activeVersionId}
                  lang={viewLang}
                  onPayload={(next) => setTestSession(next)}
                />
                <div className="space-y-6">
                {sessionRunning && (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-[13px] text-emerald-900"
                  >
                    <Lock size={15} className="shrink-0" />
                    {t('test.answersHiddenDuringSession')}
                  </div>
                )}
                {(displayedTest?.questions || []).map((q, i) => (
                  <StaffPanel key={i} large className="p-5 sm:p-7 space-y-5">
                    <div className="flex items-start gap-4">
                      <div className={staffIndexBadge}>{i + 1}</div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className={staffQuestionText}>{q.question}</p>
                        {/* Faqat kitob parchasiga tayangan savolda — eski «o'xshash parcha» manba sifatida ko'rsatilmaydi. */}
                        {q.grounded && <QuestionSource references={q.references} />}
                      </div>
                      {questionStats[i] && questionStats[i].n > 0 && (
                        <span
                          className={`ml-auto shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold tabular-nums ${
                            questionStats[i].pct >= 70
                              ? 'bg-emerald-50 text-emerald-800'
                              : questionStats[i].pct >= 40
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-rose-50 text-rose-800'
                          }`}
                        >
                          {t('test.questionCorrectShare', {
                            ok: String(questionStats[i].ok),
                            n: String(questionStats[i].n),
                            pct: String(questionStats[i].pct),
                          })}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {q.options.map((option, optIdx) => {
                        const optionExplanation = hideAnswers ? '' : q.optionExplanations?.[optIdx]?.trim();
                        const picked = questionStats[i]?.counts[optIdx] ?? 0;
                        // Sessiya ketayotganda to'g'ri variant ajratib ko'rsatilmaydi.
                        const isCorrect = !hideAnswers && optIdx === q.correctOptionIndex;
                        return (
                          <div
                            key={optIdx}
                            className={isCorrect ? staffOptionCorrect : staffOptionNeutral}
                          >
                            <div className="text-[14px] leading-relaxed">
                              <span className="font-bold">{String.fromCharCode(65 + optIdx)})</span>{' '}
                              {stripOptionLabels(q.options)[optIdx]}
                              {isCorrect && (
                                <span className="ml-2 inline-flex items-center text-[11px] font-bold uppercase tracking-wide">
                                  <CheckCircle2 size={14} className="mr-1" /> {t('test.correctAnswer')}
                                </span>
                              )}
                              {questionStats[i] && questionStats[i].n > 0 && (
                                <span className="ml-2 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
                                  {t('test.optionPicked', { count: String(picked) })}
                                </span>
                              )}
                            </div>
                            {optionExplanation && (
                              <p className="mt-1.5 text-[13px] leading-relaxed opacity-75">
                                {optionExplanation}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {!hideAnswers && (
                    <div className={staffExplainBox}>
                      <h4 className={staffExplainTitle}>
                        <Brain size={14} className="shrink-0" /> {t('test.correctAnalysis')}
                      </h4>
                      <p className={staffExplainBody}>{q.explanation}</p>
                      {q.references && q.references.length > 0 && (
                        <MedicalReferencesList
                          references={q.references}
                          title={t('test.questionReferences')}
                          compact
                          className="bg-white/60"
                        />
                      )}
                    </div>
                    )}
                  </StaffPanel>
                ))}
                {displayedTest?.references && displayedTest.references.length > 0 && (
                  <MedicalReferencesList references={displayedTest.references} />
                )}
                </div>
                </TranslationGate>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-3 pt-2">
              {sessionClosed ? (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={loading || busyElsewhere}
                  className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 bg-slate-900 text-white hover:bg-slate-700 px-4 py-2.5 text-[13.5px]"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  {t('test.createNewAfterClose')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={loading || busyElsewhere}
                  className="inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 bg-slate-900 text-white hover:bg-slate-700 px-4 py-2.5 text-[13.5px]"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                  {t('test.createAnother')}
                </button>
              )}
            </div>
          </motion.div>
        )}
    </StaffPageLayout>
  );
}

/** Talaba telefonida natija va savollar tahlili — o'qituvchi testni tahlil qilgandan keyin. */
function StudentResult({ result }: { result: LiveTestMyResult }) {
  const { t } = useUiText();
  if (!result.submitted) {
    return (
      <div className="rounded-xl bg-amber-50 px-5 py-6 text-center text-amber-900">
        <Lock size={28} className="mx-auto mb-2 text-amber-700" />
        <p className="font-semibold">{t('test.studentNotSubmitted')}</p>
      </div>
    );
  }
  const total = result.total ?? 0;
  const score = result.score ?? 0;
  const pct = total ? Math.round((score / total) * 100) : 0;
  const grade = scoreToGrade(score, total);
  return (
    <div className="space-y-4" data-testid="student-result">
      <div className="rounded-2xl bg-white p-5 text-center ring-1 ring-slate-900/[0.06]">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-500">{t('test.studentResultTitle')}</p>
        <p className="mt-1 text-[34px] font-bold tabular-nums text-slate-900">
          {score} / {total}
        </p>
        <p className="text-[14px] text-slate-600">
          {pct}% ·{' '}
          <span className={`inline-flex min-w-[2rem] justify-center rounded-lg border px-2 py-0.5 font-bold ${gradeBadgeClass(grade)}`}>
            {grade}
          </span>
        </p>
      </div>
      {(result.questions || []).map((q, i) => {
        const right = q.answer === q.correctIndex;
        return (
          <div key={i} className={`space-y-3 rounded-2xl bg-white p-4 ring-1 ${right ? 'ring-emerald-200' : 'ring-rose-200'}`}>
            <div className="flex items-start gap-3">
              <div className={staffIndexBadge}>{i + 1}</div>
              <p className={staffQuestionText}>{q.question}</p>
            </div>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => {
                const isCorrect = oi === q.correctIndex;
                const mine = oi === q.answer;
                return (
                  <div
                    key={oi}
                    className={`rounded-xl border p-2.5 text-[13.5px] leading-relaxed ${
                      isCorrect
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold'
                        : mine
                          ? 'border-rose-300 bg-rose-50 text-rose-900'
                          : 'border-slate-200 text-slate-600'
                    }`}
                  >
                    <span className="font-bold">{String.fromCharCode(65 + oi)})</span> {stripOptionLabels(q.options)[oi]}
                    {mine && <span className="ml-2 text-[11px] font-bold uppercase">· {t('test.studentYourAnswer')}</span>}
                  </div>
                );
              })}
              {q.answer < 0 && <p className="text-[12.5px] font-semibold text-rose-700">{t('test.studentNoAnswer')}</p>}
            </div>
            {q.explanation && <p className="rounded-xl bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700">{q.explanation}</p>}
          </div>
        );
      })}
    </div>
  );
}
