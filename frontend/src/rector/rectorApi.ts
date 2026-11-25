/**
 * Rektor hisoboti — API mijozi.
 *
 * Rektor iMentor foydalanuvchisi emas: token faqat parol bilan olinadi va
 * faqat `/rector/*` marshrutlariga yaraydi. Shuning uchun u alohida kalitda
 * saqlanadi va oddiy seansga umuman aralashmaydi.
 */

import { httpJson } from '../api/httpClient';

const TOKEN_KEY = 'imentor-rector-token-v1';

function apiBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE_URL?.trim() || '/api';
}

export function loadRectorToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* xotira yopiq bo'lsa ham joriy seans ishlaydi */
  }
}

export function clearRectorToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* muhim emas */
  }
}

function authHeader(): Record<string, string> {
  const t = loadRectorToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function rectorLogin(password: string, username = ''): Promise<void> {
  const r = await httpJson<{ access: string }>(`${apiBaseUrl()}/v1/rector/login/`, {
    method: 'POST',
    body: { username: username.trim(), password },
  });
  if (!r?.access) throw new Error('Token kelmadi.');
  storeToken(r.access);
}

/* ==================== Turlar ==================== */

export type PageStat = { page: string; minutes: number; seconds: number; opens: number };

export type TeacherRow = {
  schedule_linked?: boolean;
  /** Monitor jadvali bo'yicha oraliqdagi rejadagi paralar; null — jadvalda yo'q. */
  scheduled_lessons?: number | null;
  schedule_departments?: string[];
  owner_key: string;
  display_name: string;
  department: string;
  job_title: string;
  role: string;
  last_login: string | null;
  minutes: number;
  active_days: number;
  pages: PageStat[];
  videos_viewed: number;
  handouts_viewed: number;
  cases_created: number;
  tests_created: number;
  handouts_created: number;
  videos_created: number;
  presentations_created: number;
  live_sessions: number;
  online_lessons: number;
  students_taught: number;
  student_attempts: number;
  avg_student_score: number | null;
  created_total: number;
  lessons_total: number;
  is_active: boolean;
};

type StudentBucket = {
  key: string;
  name: string;
  attempts: number;
  score: number;
  total: number;
  minutes: number;
  percent: number | null;
  band: string;
  last_at: string | null;
};

export type StudentDetail = {
  student_id: string;
  display_name: string;
  /** false — talaba ID'siz kirgan, ism-familiya bo'yicha ajratilgan. */
  has_id: boolean;
  from: string;
  to: string;
  attempts_count: number;
  score_sum: number;
  score_total: number;
  avg_percent: number | null;
  band: string;
  minutes: number;
  first_at: string | null;
  last_at: string | null;
  rank: number;
  rank_total: number;
  best_percent: number;
  worst_percent: number;
  subjects: StudentBucket[];
  teachers: StudentBucket[];
  days: StudentBucket[];
  attempts: Array<{
    id: number;
    submitted_at: string;
    subject_code: string;
    subject_name: string;
    topic: string;
    variant: string;
    teacher_key: string;
    teacher_name: string;
    score: number;
    total: number;
    percent: number | null;
    band: string;
    minutes: number;
  }>;
  online: { lessons: number; minutes: number; tests: number; avg_percent: number | null };
};

export type LessonRow = {
  kind: 'live_test' | 'online_lesson';
  kind_label: string;
  id: string;
  session_key: string;
  teacher_key: string;
  teacher_name: string;
  department: string;
  subject_code: string;
  subject_name: string;
  topic: string;
  group_name: string;
  held_at: string | null;
  students: number;
  avg_score: number | null;
  is_closed: boolean;
};



export type MonitorSlot = {
  monitor_id: string;
  department: string;
  building: string;
  room: string;
  room_full: string;
  date: string;
  weekday: string;
  para: string;
  start_time: string;
  end_time: string;
  teacher_name: string;
  teacher_key: string;
  subject: string;
  group: string;
  lesson_type: string;
  status: string;
  planned: boolean;
  used: boolean;
  student_count: number;
  /** Reja manbai: 'hemis' — HEMIS'dan (har kuni yangilanadi), 'excel' — kafedra fayli. */
  source?: 'hemis' | 'excel' | '';
};

export type FilterOptions = {
  departments: string[];
  subjects: Array<{ code: string; name: string }>;
  groups: string[];
  academic_years: string[];
  bands: Array<{ key: string; label: string }>;
  /** Kirgan odamning doirasi. `groups` to'ldirilgan bo'lsa — guruh bilan
   *  cheklangan dekan: kafedra kesimida ishlaydigan bo'limlar unga 403. */
  scope?: { kind?: string; label?: string; departments?: string[]; groups?: string[] };
  /** Kafedra -> fakultet (aqlli filtrda guruhlash uchun, 2026-11-15). */
  department_faculty?: Record<string, string>;
};

export type TeacherDetail = TeacherRow & {
  from: string;
  to: string;
  total_minutes: number;
  days: Array<{
    date: string;
    minutes: number;
    pages: PageStat[];
    videos_viewed: number;
    handouts_viewed: number;
    cases_created: number;
    tests_created: number;
    live_sessions: number;
  }>;
  lessons: LessonRow[];
  /** O'qituvchining monitor jadvali (faqat rejadagi slotlar). */
  monitor?: {
    planned_slots: number;
    used_slots: number;
    usage_percent: number | null;
    slots: MonitorSlot[];
  };
};

export type MetricColumn = { key: string; label: string; align?: 'left' | 'right' };

export type MetricRow = Record<string, string | number | null>;

/** Bitta raqamning ortidagi ro'yxat va uning ta'rifi. */
export type MetricDetail = {
  metric: string;
  title: string;
  explain: string;
  method: string;
  source: string;
  value: string;
  from: string;
  to: string;
  department: string;
  total: number;
  shown: number;
  columns: MetricColumn[];
  rows: MetricRow[];
};

/* ---------- Admin panelidan ko'chirilgan hisobotlar ---------- */

export type ReportFilters = {
  from: string;
  to: string;
  department?: string;
  subject_code?: string;
  q?: string;
  band?: string;
  teacher?: string;
  only_active?: boolean;
  /**
   * Real-time yangilash uchun hisoblagich. Serverga YUBORILMAYDI — har
   * so'rov query'ni aniq maydonlardan yig'adi. U faqat bo'limlarga
   * "qaytadan so'ra" degan signal beradi.
   */
  refreshKey?: number;
};

/* ==================== So'rovlar ==================== */

/** Bo'sh qiymatlarni tashlab, query satrini yig'adi. */
function query(filters: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    q.set(key, String(value));
  }
  return q.toString();
}

export function get<T>(path: string): Promise<T> {
  // `retryOnUnauthorized: false` MUHIM (2026-09-26): rektor seansi tugaganda
  // umumiy httpClient shu brauzerdagi O'QITUVCHI tokenini yangilab qayta
  // urinardi — u rektor huquqiga ega emas, natijada parol oynasi o'rniga
  // "HTTP 403" chiqib qolardi.
  // Umumiy chegara 12 soniya, lekin uzun davr hisoboti (30 kun) serverda
  // 15-20 soniya hisoblanadi — sahifa natijani kutmay "so'rov vaqti tugadi"
  // derdi (2026-10-09).
  return httpJson<T>(`${apiBaseUrl()}/v1/rector${path}`, {
    headers: authHeader(),
    retryOnUnauthorized: false,
    timeoutMs: 90000,
  });
}

export function fetchFilters(): Promise<FilterOptions> {
  return get('/filters/');
}



export function fetchTeacherDetail(ownerKey: string, f: ReportFilters): Promise<TeacherDetail> {
  return get(`/teachers/${encodeURIComponent(ownerKey)}/?${query({ from: f.from, to: f.to })}`);
}

export function fetchStudentDetail(studentKey: string, f: ReportFilters): Promise<StudentDetail> {
  return get(`/students/${encodeURIComponent(studentKey)}/?${query({ from: f.from, to: f.to })}`);
}

export function fetchMetricDetail(
  metric: string,
  f: ReportFilters,
  limit?: number,
): Promise<MetricDetail> {
  return get(
    `/detail/?${query({ metric, from: f.from, to: f.to, department: f.department, limit })}`,
  );
}

/* ==================== Dars jadvali bo'yicha nazorat (2026-09-25) ==================== */

export type ScheduledLessonRow = {
  id: number;
  date: string;
  /** Admin tasdiqlagan kasallik varaqasi / ta'til / safar kuni, dars o'tilmagan (2026-10-28). */
  absence?: { kind: string; label: string };
  weekday: string;
  para: string;
  start_time: string;
  end_time: string;
  teacher_name: string;
  teacher_key: string;
  department: string;
  subject: string;
  group: string;
  lesson_type: string;
  room: string;
  building: string;
  monitor_id: string;
  used: boolean;
  /** Dars hali tugamagan — baholanmaydi. */
  pending?: boolean;
  /** Ma'ruza/laboratoriya — foizga kirmaydi. */
  counted?: boolean;
  students: number;
  /** Shu darsning o'zida iMentor'da sof ishlangan daqiqa (2026-11-14). */
  minutes?: number;
  /** Qanday baholangani: full | students | block | short | none | pending. */
  /** `group` — o'qituvchida qayd yo'q, faqat guruh talabalari faol (2026-11-17: "chala"). */
  /** `misuse` — vaqt yetarli, lekin test/keys yaratilmagan yoki ularga 10 daqiqadan kam (2026-11-19). */
  verdict?: 'full' | 'students' | 'block' | 'short' | 'group' | 'misuse' | 'none' | 'pending';
  /** Test/keys holati: yaratildimi, necha daqiqa, sikl (ketma-ket paralar soni), nima yetishmaydi. */
  modules?: LessonModules | null;
  /** Ketma-ket paralar bloki uzunligi (block bo'lsa). */
  block_size?: number;
  /** Dars vaqtida ochilgan jonli test mavzulari — HEMIS jadvalida mavzu yo'q. */
  topics?: string[];
  // Dalil: qator qaysi HEMIS yozuvidan va qaysi inventar xonasidan kelgan.
  hemis_id: string;
  auditorium_code: string;
  monitor_room: string;
  monitor_department: string;
  synced_at: string | null;
  hemis_status?: string;
  hemis_missing_at?: string | null;
  evidence?: {
    status: string; room_presence: string; note: string; seconds: number;
    reported_seconds?: number; overlap_seconds?: number;
    first_event?: string | null; last_event?: string | null;
    pages: Array<{ page: string; seconds: number; opens: number }>;
    events: Array<{ id: number; at: string; action: string; page: string; seconds: number }>;
  };
};

/* ==================== Nazorat paneli (2026-09-25) ==================== */

export type ControlTeacher = {
  teacher_key: string;
  teacher_name: string;
  employee_id: string;
  linked: boolean;
  department: string;
  monitor_lessons: number;
  monitor_used: number;
  monitor_percent: number | null;
  band: 'good' | 'warn' | 'bad' | 'none';
  other_lessons: number;
  other_used: number;
  lessons: number;
  students: number;
  days: number;
  rooms: string[];
  last_used: string | null;
  // Ikkinchi qatlam: darsda ochgani emas, iMentor'da NIMA qilgani.
  minutes: number;
  active_days: number;
  created: Record<string, number>;
  created_total: number;
  top_module: string;
  /** Har bo'limda (sahifada) qancha vaqt — kartada (2026-11-19). */
  modules?: Array<{ page: string; label: string; minutes: number }>;
  /** Har monitorli darsda test/keys (eng yangisi birinchi, ≤12). */
  lesson_modules?: LessonModuleRow[];
  test_lessons?: number;
  case_lessons?: number;
  misuse_lessons?: number;
  short_lessons?: number;
  depth: 'worked' | 'viewed' | 'visit' | 'none';
  profile_percent: number | null;
  profile_missing: string[];
  subjects_linked: number;
  material_percent: number | null;
  material_topics: number;
  material_empty: number;
  // Nechta darsi ishlayotgani isbotlangan xonada bo'lgan; bahona shu bilan hal bo'ladi.
  proven_lessons: number;
  excuse: 'none' | 'check_room';
  /** Davrdagi holati — har o'qituvchi faqat bitta toifada. */
  state?: 'full' | 'partial' | 'opened' | 'none' | 'on_leave' | 'unlinked' | 'offsite';
  /** Monitorli darslaridan o'tilmay qolgani. */
  monitor_missed?: number;
  /** Bugun hali tugamagan (baholanmagan) monitorli darslari. */
  pending_lessons?: number;
};

export type ControlRoom = {
  monitor_id: string;
  room: string;
  department: string;
  hemis_rooms: string[];
  building: string;
  lessons: number;
  used: number;
  percent: number;
  teachers: number;
  used_teachers: number;
  departments: string[];
  last_used: string | null;
  status: 'ok' | 'suspect' | 'quiet';
  status_label: string;
};

export type ControlAttention = {
  teacher_key: string;
  teacher_name: string;
  employee_id: string;
  department: string;
  monitor_lessons: number;
  days: number;
  rooms: string[];
  other_used: number;
  other_lessons: number;
  proven_lessons: number;
  excuse: 'none' | 'check_room' | 'blamed';
  /** Aniq sabab (2026-10-21): kod, qisqa nomi va dalilli gaplar. */
  reason?: IdleReason | '';
  reason_label?: string;
  reasons?: string[];
};

export type IdleReason =
  | 'parallel'
  | 'short'
  | 'twin_account'
  | 'never_used'
  | 'absent_day'
  | 'outside_lesson'
  | 'room'
  | 'unknown';

export type ControlModule = { page: string; label: string; minutes: number; opens: number; people: number };

export type ControlReport = {
  from: string;
  to: string;
  headline: {
    monitor_lessons: number;
    monitor_used: number;
    monitor_percent: number;
    band: 'good' | 'warn' | 'bad' | 'none';
    /** Katta foiz: iMentor ishlatilgan darslar (to'liq + yetarsiz). */
    monitor_touched?: number;
    monitor_touched_percent?: number;
    touch_band?: 'good' | 'warn' | 'bad' | 'none';
    watched_teachers: number;
    idle_teachers: number;
    other_lessons: number;
    other_used: number;
    other_percent: number;
    unlinked_teachers: number;
    total_lessons: number;
    blamed_teachers: number;
    check_room_teachers: number;
    /** Monitorli xonada darsi umuman yo'q — asosiy foizga kirmaydi. */
    offsite_teachers: number;
    /** Kasallik varaqasi / ta'til / safar (admin tasdiqlagan) kunlaridagi o'tilmagan darslar — hech bir raqamga kirmaydi. */
    absence_lessons?: number;
    absence_teachers?: number;
    offsite_marked_lessons?: number;
    offsite_marked_teachers?: number;
    /** Kirgan, lekin darsni iMentor'da o'tmagan (chegaradan past). */
    short_lessons: number;
    short_teachers: number;
    /** Dars "o'tilgan" deyish uchun kerak bo'lgan eng kam daqiqa. */
    min_lesson_minutes: number;
    /** Monitorli darslar ishlangan vaqt bo'yicha (yig'indisi = monitor_lessons).
     *  full — chegaradan o'tgan; near — NEAR..chegara; brief — 1..NEAR; none — ochilmagan. */
    work_buckets?: { full: number; near: number; brief: number; none: number };
    short_near_teachers?: number;
    short_brief_teachers?: number;
    /** "Yaqin" toifasining pastki chegarasi (daqiqa). */
    near_minutes?: number;
    /** Kamida bitta darsini iMentor'da o'tgan o'qituvchilar va ularning ulushi. */
    teachers_used?: number;
    teacher_percent?: number;
    /** O'qituvchilar toifalari (yig'indisi = watched_teachers). */
    teacher_buckets?: { full: number; partial: number; opened: number; none: number; on_leave: number; unlinked: number };
    partial_missed_lessons?: number;
    /** Hali tugamagan darslar — hech bir raqamga kirmagan. */
    pending?: {
      lessons: number;
      monitor_lessons: number;
      teachers: number;
      as_of: string | null;
      /** Eng yaqin tugash vaqti — "raqamlar qachon paydo bo'ladi" degan javob. */
      next_at?: string | null;
    };
  };
  attention: ControlAttention[];
  check_room: ControlAttention[];
  rooms: ControlRoom[];
  room_summary: { rooms: number; ok: number; suspect: number; quiet: number; suspect_lessons: number };
  source: {
    synced_at: string | null;
    lessons: number;
    teachers: number;
    unlinked_teachers: number;
    rooms_without_monitor: number;
  };
  daily: Array<{ date: string; weekday: string; lessons: number; used: number; percent: number;
    /** O'qituvchilar bo'yicha (2026-11-15): shu kuni darsi bo'lganlar va iMentor'da o'tganlar ulushi. */
    teachers?: number; teachers_used?: number; teacher_percent?: number | null }>;
  /** Fakultet → kafedra kesimi (2026-11-16). */
  sections?: import('./SectionsCard').Section[];
  /** Kafedra tanlangan, nazoratda hech kim yo'q — sababi (2026-11-16). */
  scope_note?: {
    department: string;
    lessons: number;
    practical: number;
    practical_teachers: number;
    clinical: number;
    clinical_teachers: number;
    monitor: number;
    rooms_without_monitor: Array<{ room: string; lessons: number }>;
    non_clinical_subjects: Array<{ subject: string; lessons: number }>;
  } | null;
  departments: Array<{
    department: string;
    monitor_lessons: number;
    monitor_used: number;
    percent: number;
    band: 'good' | 'warn' | 'bad' | 'none';
    /** "Ishlatilgan" (to'liq + qisqa) — asosiy foiz bilan bir xil (2026-10-19). */
    monitor_touched?: number;
    touched_percent?: number;
    touched_band?: 'good' | 'warn' | 'bad' | 'none';
    touching_teachers?: number;
    teachers: number;
    active_teachers: number;
    other_lessons: number;
    /** Monitorsiz xonadagi darslardan iMentor'da o'tilganlari (2026-10-19). */
    other_used?: number;
  }>;
  /** FAQAT monitorli xonada darsi borlar. */
  teachers: ControlTeacher[];
  /** Klinika bazasida yoki masofadan dars o'tadiganlar — alohida. */
  offsite: {
    teachers: ControlTeacher[];
    count: number;
    lessons: number;
    used: number;
    places: Array<{ place: string; lessons: number; used: number; teachers: number; percent: number }>;
    places_total: number;
  };
  quality: {
    minutes: number;
    worked: number;
    viewed: number;
    visit: number;
    never: number;
    no_subject: number;
    profile_incomplete: number;
    teachers: number;
  };
  modules: ControlModule[];
  created: Record<string, number>;
  created_labels: Record<string, string>;
};

export type ControlStudentRow = {
  student_key: string;
  name: string;
  group: string;
  course: number | null;
  faculty: string;
  in_contingent: boolean;
  attempts: number;
  avg_score: number;
};

export type ControlStudents = {
  from: string;
  to: string;
  students: ControlStudentRow[];
  totals: {
    contingent: number;
    tested: number;
    matched_to_contingent: number;
    attempts: number;
    avg_score: number;
    coverage: number;
    groups_active: number;
    groups_total: number;
  };
  groups: Array<{
    group: string;
    tested_students: number;
    group_size: number;
    coverage: number;
    attempts: number;
    avg_score: number;
  }>;
};

/** Institutning hamma tizimi bitta javobda. */
export type PlatformsReport = {
  from: string;
  to: string;
  platforms: Array<{
    key: string;
    label: string;
    link: string;
    /** `true` — raqamlar shu so'rovda hisoblandi; `false` — soatlik nusxadan. */
    live: boolean;
    /** `false` — oxirgi yig'ish o'tmagan: raqamlar eski. */
    ok: boolean;
    note: string;
    collected_at: string | null;
    cards: Array<{ metric: string; title: string; value: number | string; hint: string }>;
  }>;
  /** Hali ulanmagan tizimlar — sababi bilan. */
  missing: Array<{ key: string; label: string; note: string }>;
};

export function fetchPlatforms(f: ReportFilters): Promise<PlatformsReport> {
  return get(`/platforms/?${query({ from: f.from, to: f.to })}`);
}

/** Bosh sahifa uchun: faqat nomlar — raqamlar hisoblanmaydi, shuning uchun tez. */
export function fetchPlatformNames(f: ReportFilters): Promise<PlatformsReport> {
  return get(`/platforms/?${query({ from: f.from, to: f.to, names: '1' })}`);
}

export function fetchControlReport(f: ReportFilters): Promise<ControlReport> {
  return get(`/control/?${query({ from: f.from, to: f.to, department: f.department, q: f.q })}`);
}

/** Sahifadagi bitta raqam ortidagi odam. */
export type ControlPerson = {
  key: string;
  kind: 'teacher' | 'student' | 'group';
  name: string;
  subtitle: string;
  value: number;
  value_label: string;
  note: string;
  /** «Umuman ochmagan» uchun dalil (2026-11-16). */
  proof?: AbsenceProof | null;
  /** «Surunkalilar» (2026-11-19): oxirgi 30 kundagi dars kunlari va kafedra mas'uli. */
  chronic?: ChronicInfo | null;
};

export type ChronicDayKind = 'ok' | 'misuse' | 'short' | 'none';

export type ChronicInfo = {
  lesson_days: number;
  bad_days: number;
  share: number;
  /** Oxirgi dars kunlaridan ketma-ket nechtasi muammoli. */
  streak: number;
  none_days: number;
  short_days: number;
  misuse_days: number;
  last_ok: string | null;
  first_bad: string | null;
  last_bad: string | null;
  strip: Array<{ date: string; kind: ChronicDayKind }>;
  responsible: Array<{ name: string; position: string; departments: string[] }>;
  departments: string[];
};

export type ChronicWindow = {
  from: string;
  to: string;
  days: number;
  min_bad_days: number;
  min_share: number;
  module_rule_from: string;
};

export type AbsenceProof = {
  /** Davrda o'z hisobidagi hamma qaydlar soni va birinchisi. */
  events: number;
  first: string | null;
  qr: number;
  live_tests: number;
  /** Davrdan oldingi oxirgi faolligi. */
  last_before: string | null;
  /** Monitorli xonalari va ulardan boshqa o'qituvchilar iMentor'da dars o'tganlari. */
  rooms: number;
  rooms_working: number;
};

export type ControlPeople = {
  metric: string;
  title: string;
  kind: 'teacher' | 'student' | 'group';
  total: number;
  people: ControlPerson[];
  /** Faqat «chronic» ro'yxatida: qaysi oyna va qanday chegara bilan. */
  window?: ChronicWindow;
};

/** Raqam bosilganda — uning ortidagi ro'yxat. */
export function fetchControlPeople(
  f: ReportFilters,
  metric: string,
): Promise<ControlPeople> {
  return get(`/control/people/?${query({ from: f.from, to: f.to, department: f.department, metric })}`);
}

/** Haftalar bo'yicha monitorli darslarda iMentor ishlatilishi (2026-10-15). */
export type ControlTrend = {
  from: string;
  to: string;
  weeks: Array<{
    week_start: string;
    week_end: string;
    lessons: number;
    used: number;
    touched: number;
    percent: number | null;
    touched_percent: number | null;
  }>;
};

export function fetchControlStudents(f: ReportFilters): Promise<ControlStudents> {
  return get(`/control/students/?${query({ from: f.from, to: f.to })}`);
}

export type ControlTeacherDetail = {
  teacher_key: string;
  profile: {
    display_name: string;
    job_title: string;
    department: string;
    last_login: string | null;
    /** Tanlangan davr ichidagi oxirgi faol kun (davrdan tashqarisi hisobga olinmaydi). */
    last_active: string | null;
  };
  summary: ControlTeacher | null;
  materials: {
    handouts: number;
    videos: number;
    presentations: number;
    live_sessions: number;
    students_taught: number;
    student_attempts: number;
  };
  subjects: Array<{ subject: string; lessons: number; used: number; monitor: number; percent: number }>;
  rooms: ControlRoom[];
  engagement: {
    minutes: number;
    active_days: number;
    depth: 'worked' | 'viewed' | 'visit' | 'none';
    depth_label: string;
    modules: Array<{ page: string; label: string; minutes: number; opens: number }>;
    created: Record<string, number>;
    created_total: number;
    created_labels: Record<string, string>;
    viewed: { videos: number; handouts: number };
    days: Array<{ date: string; minutes: number; tests: number; cases: number; live_sessions: number }>;
  };
  profile_check: { percent: number; missing: string[]; have: Record<string, boolean>; subjects: number };
  subject_materials: {
    percent: number;
    topics: number;
    empty: number;
    handout: number;
    presentation: number;
    video: number;
    rows: Array<{
      syllabus_id: number;
      subject: string;
      variant: string;
      topics: number;
      empty: number;
      percent: number;
      handout: number;
      presentation: number;
      video: number;
    }>;
  };
  lessons: ScheduledLessonRow[];
};

export type ControlStudentDetail = {
  contingent: {
    student_id: string;
    full_name: string;
    group_name: string;
    course: number | null;
    faculty: string;
    direction: string;
    education_form: string;
    education_language: string;
    status: string;
  } | null;
  [key: string]: unknown;
};

export function fetchControlTeacher(key: string, f: ReportFilters): Promise<ControlTeacherDetail> {
  return get(`/control/teacher/${encodeURIComponent(key)}/?${query({ from: f.from, to: f.to })}`);
}

/* ==================== Bitta dars ichi (2026-11-15) ==================== */

export type LessonDetailStudent = {
  student_id: string;
  name: string;
  group: string;
  /** iMentor jonli testidagi eng yaxshi natija, %. */
  imentor: number | null;
  score: number | null;
  total: number | null;
  attempts: number;
  /** HEMIS'da shu darsga qo'yilgan baho (100 ballik). */
  hemis: number | null;
  diff: number | null;
  /** Dalillar (2026-11-16): dars oynasida birinchi ko'ringan vaqti, faol daqiqalari, testni boshlagani, oynadan chiqishlari. */
  first_seen?: string | null;
  active_minutes?: number;
  test_started?: string | null;
  tab_switches?: number;
  /** Aniq ziddiyat belgisi (pog'ona bo'yicha) — jadvalda filtr va rang uchun. */
  flag?: 'graded_without_trace' | 'low_test_high_grade' | 'high_test_low_grade' | 'tested_not_graded' | '';
};

export type LessonProof = {
  scheduled: { from: string; to: string; minutes: number };
  teacher: {
    first: string | null; last: string | null; late_minutes: number | null; early_leave_minutes: number | null;
    active_minutes: number; coverage: number; gaps: Array<{ from: string; to: string; minutes: number; open_minutes?: number; open_page?: string }>; pages_opened: number;
    /** Harakatsiz, lekin sahifa ekranda ochiq turgan daqiqalar (2026-11-19). */
    open_idle_minutes?: number;
  };
  network: { networks: number; campus: number; outside: number };
  qr: Array<{ at: string; before_lesson: boolean }>;
  /** Kamera yuzidan tanib kirgan (hisobga aynan o'zi kirgan). */
  face_logins?: Array<{ at: string; method: string; before_lesson: boolean }>;
  location: { pings: number; building: string; distance_m: number; inside: boolean; accuracy_m: number | null; at: string } | null;
  students: { roster: number; active: number; active_other: number; first_seen: string | null; peak: number; tab_switchers: number };
  timeline: Array<{ t: string; page: string | null; students: number; in_lesson: boolean; open?: boolean }>;
  /** Shu dars vaqtida guruh talabalari BOSHQA hisobning jonli testida qatnashgan (2026-11-19). */
  other_sessions?: Array<{ owner: string; name: string; students: number; first: string }>;
  journal: Array<{ at: string; who: 'teacher' | 'student'; kind: string; page?: string; minutes?: number; open_minutes?: number; to?: string; topic?: string; student_id?: string; name?: string; score?: number; total?: number; content?: string; title?: string; method?: string }>;
  /** Ikkinchi qatlam (2026-11-16). */
  room_day?: { monitor_id: string; room: string; used: number;
    /** Boshqa o'qituvchilarning va o'zining shu kungi tugagan darslari (alohida). */
    others_done?: number; others_used?: number; own_done?: number; own_used?: number;
    lessons: Array<{ para: string; start_time: string; end_time: string; teacher_name: string; teacher_key: string; subject: string; lesson_type: string; own?: boolean; pending: boolean; used: boolean; minutes: number }> } | null;
  history?: { days: number; lessons: number; done?: number; percent?: number; avg_minutes?: number; median_late?: number | null; opened?: number } | null;
  integrity?: {
    students: number;
    questions: Array<{ question: string; answered: number; correct: number; skipped: number; percent: number | null }>;
    same_wrong_pairs: Array<{ a: string; b: string; same_wrong: number; both_wrong?: number; expected?: number; wrong_a: number; wrong_b: number }>;
    fast: Array<{ student_id: string; name: string; seconds: number; questions: number; score: number }>;
  };
  hemis_flags?: { graded_without_trace: number; low_test_high_grade: number; high_test_low_grade: number; tested_not_graded: number };
};

export type LessonDetail = {
  lesson: ScheduledLessonRow & { groups: string[] };
  window: { from: string; to: string };
  live_tests: Array<{ id: number; topic: string; at: string; questions: number; students: number; average: number | null; closed: boolean }>;
  created: Array<{ kind: string; topic: string; title?: string; at: string; count: number; items: string[] }>;
  students: LessonDetailStudent[];
  summary: { roster: number; tested: number; graded: number; imentor_avg: number | null; hemis_avg: number | null; big_gap: number };
  hemis_error: string;
  proof?: LessonProof;
};

export function fetchControlLesson(id: number): Promise<LessonDetail> {
  return get(`/control/lesson/${id}/`);
}

/* ==================== O'qituvchining dalillar jadvali (2026-11-16) ==================== */

export type LessonModuleRow = {
  date: string;
  para: string;
  start: string;
  minutes: number;
  used: boolean;
  misuse: boolean;
  test: boolean;
  case: boolean;
  test_minutes: number;
  case_minutes: number;
  cycle: number;
  open: boolean;
};

export type LessonModules = {
  test: boolean;
  case: boolean;
  test_minutes: number;
  case_minutes: number;
  /** Sikl bo'lsa — ketma-ket paralar soni (test/keys butun sikl bo'yicha), aks holda 0. */
  cycle: number;
  /** 27-noyabrdan: no_answers — talabalar test yechmagan; no_reveal — keys tahlili ochilmagan; case_time — keysda kam.
   * Undan oldingi darslar: test / case — yaratilmagan; test_time / case_time — kerakli daqiqadan kam. */
  gaps: Array<'test' | 'case' | 'test_time' | 'case_time' | 'no_answers' | 'no_reveal'>;
  /** Testni yechgan talabalar soni va keys tahlili ochilgani (real foydalanish, 2026-11-27). */
  students: number;
  case_reveal: boolean;
  need_test: number;
  need_case: number;
  /** Sikl hali davom etmoqda — test/keys sikl oxirida tekshiriladi (2026-11-19). */
  open?: boolean;
};

export type DossierFlag = 'graded_not_opened' | 'not_opened' | 'short' | 'misuse' | 'late' | 'outside';

export type DossierRow = {
  id: number; date: string; weekday: string; para: string; start_time: string; end_time: string;
  subject: string; group: string; room: string; lesson_type: string;
  used: boolean; minutes: number; verdict: string;
  first: string | null; late: number | null; early: number | null; coverage: number; max_gap: number;
  network: 'campus' | 'outside' | 'none'; qr: boolean;
  students_active: number; roster: number; tested: number; hemis_graded: number | null;
  flags: DossierFlag[];
  /** Dars oynasida biror dalil bormi (o'qituvchi ishi, jonli test, QR, talabalar). */
  trace?: boolean;
};

export type TeacherDossier = {
  rows: DossierRow[];
  summary: { lessons: number; used?: number; opened?: number; median_late?: number | null; avg_coverage?: number;
    flags?: Record<DossierFlag, number>; qr?: number; hemis_graded_lessons?: number };
  hemis_error: boolean;
};

export function fetchTeacherDossier(key: string, f: ReportFilters): Promise<TeacherDossier> {
  return get(`/control/teacher/${encodeURIComponent(key)}/dossier/?${query({ from: f.from, to: f.to })}`);
}

/* ==================== HEMIS'da baho bor, iMentor ochilmagan (2026-11-16) ==================== */

export type GradedNotOpenedItem = {
  lesson_id: number; date: string; weekday: string; para: string; start_time: string; end_time: string;
  teacher_name: string; teacher_key: string; department: string; subject: string; group: string; groups: string[];
  room: string; lesson_type: string; graded: number; roster: number;
};

export type GradedNotOpened = {
  ready: boolean; at?: string; scan_from?: string; scan_to?: string; checked?: number; partial?: boolean;
  items: GradedNotOpenedItem[];
};

export function fetchGradedNotOpened(f: ReportFilters): Promise<GradedNotOpened> {
  return get(`/control/graded-not-opened/?${query({ from: f.from, to: f.to, department: f.department })}`);
}

export function fetchControlStudent(key: string, f: ReportFilters): Promise<ControlStudentDetail> {
  return get(`/control/student/${encodeURIComponent(key)}/?${query({ from: f.from, to: f.to })}`);
}

/* ==================== Boshqa joyda o'tilgan darslar (2026-11-12) ==================== */

export type RectorOffsiteItem = {
  id: number;
  owner_key: string;
  name: string;
  department: string;
  date: string;
  para: string;
  start_time: string;
  end_time: string;
  subject_name: string;
  group_name: string;
  scheduled_room: string;
  reason: string;
  reason_label: string;
  note: string;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  has_photo: boolean;
  created_at: string | null;
};

export type RectorOffsiteReport = {
  start: string;
  end: string;
  total: number;
  teachers_count: number;
  by_reason: { reason: string; label: string; count: number }[];
  items: RectorOffsiteItem[];
};

/** O'qituvchi dars vaqtida telefondan rasm va izoh bilan qayd etgan darslar. */
export function fetchRectorOffsite(f: ReportFilters): Promise<RectorOffsiteReport> {
  return get(`/offsite-lessons/?${query({ start: f.from, end: f.to })}`);
}

/** Dars rasmi (blob havola) — rasm ochiq havola bilan berilmaydi. */
export async function fetchRectorOffsitePhoto(id: number): Promise<string> {
  const res = await fetch(`${apiBaseUrl()}/v1/rector/offsite-lessons/${id}/photo/`, { headers: authHeader() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/* ------------------------------------------------------------------ Telegram bot (2026-11-18) */

export type BotStatus = 'opened' | 'never' | 'offsite' | 'pending' | 'left' | 'returned' | 'short' | 'misuse';

export type BotFeedItem = {
  id: number;
  day: string;
  slot: string;
  para: string;
  name: string;
  department: string;
  faculty: string;
  rooms: string[];
  status: BotStatus;
  late: number | null;
  offsite: string;
  contact: string;
  calls: Array<{ by: string; at: string }>;
  comments: Array<{ by: string; at: string; text: string }>;
  minutes_to_call: number | null;
  private_copy: boolean;
  /** O'z vaqtida ochgan, ma'lumot internet tufayli kech yetgan — ogohlantirish noto'g'ri chiqqan. */
  late_data?: boolean;
  alert?: '' | 'left' | 'short' | 'misuse';
  since?: string;
  returned_at?: string;
  minutes?: number | null;
  /** «Noto'g'ri foydalanildi» (2026-11-19): nima yetishmadi. */
  gaps?: Array<'test' | 'case' | 'test_time' | 'case_time' | 'no_answers' | 'no_reveal'>;
  test_minutes?: number | null;
  case_minutes?: number | null;
};

export type BotResponsible = {
  name: string;
  departments: string[];
  registered: boolean;
  posts: number;
  contacted: number;
  rate: number;
  median_minutes: number | null;
  comments: number;
  reminders: number;
  missed: Array<{ day: string; slot: string; para: string; name: string; department: string; status: BotStatus }>;
  missed_count: number;
  opened_alone: number;
  /** Post turlari bo'yicha (2026-11-18): ochmadi, davom etmoqda, chiqib ketdi, qaytdi, 40 daq dan kam, o'zi ochdi, boshqa joyda. */
  types?: Partial<Record<'never' | 'pending' | 'left' | 'returned' | 'short' | 'misuse' | 'opened' | 'offsite', number>>;
  /** Bog'lanish kerak bo'lgan holatlar (o'qituvchi o'zi ochmagan/qaytmagan) va ulardan necha foizida bog'langan. */
  needed?: number;
  effective_rate?: number | null;
  daily?: Array<{ day: string; posts: number; contacted: number }>;
};

export type BotDepartment = {
  department: string;
  faculty: string;
  contact: string;
  posts: number;
  teachers: number;
  never: number;
  opened: number;
  offsite: number;
  contacted: number;
  comments: number;
  contact_rate: number;
  never_rate: number;
};

export type BotTeacher = {
  teacher: string;
  name: string;
  department: string;
  faculty: string;
  posts: number;
  never: number;
  opened: number;
  contacted: number;
  days: number;
  last: string;
  avg_late: number | null;
};

export type TelegramBotReport = {
  range: { from: string; to: string };
  summary: {
    posts: number;
    teachers: number;
    opened: number;
    never: number;
    offsite: number;
    pending: number;
    avg_late: number | null;
    late_data?: number;
    left?: number;
    left_returned?: number;
    short?: number;
    contactable: number;
    contacted: number;
    contact_rate: number;
    median_minutes: number | null;
    comments: number;
    reminders: number;
    responsible_total: number;
    responsible_registered: number;
  };
  conclusions: Array<{ kind: 'info' | 'warn' | 'good'; text: string }>;
  responsible: BotResponsible[];
  departments: BotDepartment[];
  teachers: BotTeacher[];
  days: Array<{ day: string; posts: number; never: number; opened: number; offsite: number; pending: number; contacted: number }>;
  feed: BotFeedItem[];
  unregistered: string[];
};

export function fetchTelegramBot(f: ReportFilters): Promise<TelegramBotReport> {
  return get(`/telegram-bot/?${query({ from: f.from, to: f.to, department: f.department })}`);
}
