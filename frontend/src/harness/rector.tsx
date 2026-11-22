/**
 * Rektor hisobotini parolsiz va serversiz ko'rish (dizayn tekshiruvi).
 *
 * `rector-harness.html` faqat `npm run dev` da ochiladi, `vite build` uni
 * yig'maydi. HAQIQIY `RectorApp` chiziladi, `fetch` esa soxta: har so'rovga
 * haqiqiy shakldagi, lekin TO'QIMA ma'lumot qaytaradi. Bu yerda haqiqiy
 * ism, telefon yoki parol yo'q — ombor ochiq.
 */
import { createRoot } from 'react-dom/client';
import '../index.css';
import RectorApp from '../rector/RectorApp';
import { REPORT } from './controlPreview';

const FIRST = ['AZIZOV', 'BOBOYEVA', 'KARIMOV', 'TOSHEVA', 'RAHIMOV', 'YUSUPOVA', 'NURMATOV', 'SOLIYEVA', 'XOLMATOV', 'QODIROVA', 'ERGASHEV', 'MIRZAYEVA'];
const LAST = ['ANVAR', 'DILNOZA', 'JASUR', 'MADINA', 'OTABEK', 'SEVARA', 'BEKZOD', 'NODIRA', 'SHERZOD', 'ZARINA'];
const name = (i: number) => `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
const FACULTIES = ['Davolash ishi fakulteti', 'Pediatriya fakulteti', 'Xalqaro fakultet', 'Tibbiy profilaktika va jamoat salomatligi fakulteti', 'Magistratura bo‘limi'];
const GROUPS = ['DI-2825', 'DI-2725', 'P-5124', 'P-5326', 'MD-116', 'MD-1118', 'TPI-323', 'TPI-1025', 'DI-4324 A', 'P-5724', 'MD-131/25', 'Xirurgiya-25'];

const days = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];

const CONTROL = {
  ...REPORT,
  from: '2026-10-09',
  to: '2026-10-15',
  headline: {
    ...REPORT.headline,
    monitor_lessons: 2191,
    monitor_used: 902,
    monitor_percent: 41,
    monitor_touched: 1402,
    monitor_touched_percent: 64,
    touch_band: 'warn' as const,
    band: 'warn' as const,
    teachers_used: 171,
    teacher_percent: 72,
    near_minutes: 30,
    short_near_teachers: 58,
    short_brief_teachers: 41,
    work_buckets: { full: 902, near: 318, brief: 182, none: 789 },
    teacher_buckets: { full: 96, partial: 61, opened: 14, none: 68, on_leave: 4, unlinked: 3 },
    partial_missed_lessons: 143,
  },
  daily: [
    { date: '2026-10-09', weekday: 'Payshanba', lessons: 427, used: 250, percent: 59 },
    { date: '2026-10-10', weekday: 'Juma', lessons: 470, used: 301, percent: 64, teachers: 120, teacher_percent: 63 },
    { date: '2026-10-11', weekday: 'Shanba', lessons: 120, used: 48, percent: 40, teachers: 120, teacher_percent: 79 },
    { date: '2026-10-12', weekday: 'Dushanba', lessons: 426, used: 289, percent: 68, teachers: 120, teacher_percent: 81 },
    { date: '2026-10-13', weekday: 'Seshanba', lessons: 427, used: 301, percent: 70, teachers: 120, teacher_percent: 77 },
    { date: '2026-10-14', weekday: 'Chorshanba', lessons: 429, used: 316, percent: 74, teachers: 120, teacher_percent: 72 },
    { date: '2026-10-15', weekday: 'Payshanba', lessons: 322, used: 197, percent: 61, teachers: 120, teacher_percent: 85 },
  ],
};

const STUDENT_ROWS = Array.from({ length: 160 }, (_, i) => {
  const took = i % 5 !== 0;
  const percent = took ? 38 + ((i * 37) % 60) : null;
  return {
    student_id: `34425${String(100000 + i)}`,
    student_key: `ot_34425${String(100000 + i)}`,
    full_name: name(i),
    group_name: GROUPS[i % GROUPS.length],
    course: (i % 6) + 1,
    faculty: FACULTIES[i % 4],
    direction: i % 3 ? 'Davolash ishi' : 'Pediatriya ishi',
    attempts: took ? 1 + (i % 7) : 0,
    subjects: took ? 1 + (i % 3) : 0,
    days: took ? 1 + (i % 4) : 0,
    percent,
    grade: percent === null ? null : percent >= 86 ? 5 : percent >= 71 ? 4 : percent >= 55 ? 3 : 2,
    minutes: took ? 6 + (i % 30) : 0,
    last_at: took ? `${days[i % 7]}T10:3${i % 10}:00+05:00` : null,
  };
});

const STUDENTS = {
  from: '2026-10-09',
  to: '2026-10-15',
  headline: { students: 7643, took_test: 4105, never: 3538, attempts: 15064, percent: 74 },
  students: STUDENT_ROWS,
};

const OVERVIEW = {
  from: '2026-10-09',
  to: '2026-10-15',
  headline: {
    students: 7643, took: 4105, coverage: 54, attempts: 15064, percent: 74, never: 3538, grade: 4,
    tests: 1130, teachers: 133, at_risk: 309,
    in_class: { students: 6114, took: 4089, coverage: 67, attempts: 15050, percent: 74 },
  },
  previous: { from: '2026-10-02', to: '2026-10-08', took: 3031, coverage: 40, attempts: 8940, percent: 68 },
  daily: days.map((d, i) => ({
    date: d,
    attempts: [2577, 2704, 161, 0, 3046, 2738, 3789][i] ?? 0,
    students: [1810, 1902, 140, 0, 2101, 1990, 2480][i] ?? 0,
    percent: [71, 73, 66, null, 75, 74, 77][i] ?? null,
  })),
  distribution: [
    { grade: 5, label: 'A’lo', from: 86, students: 1121 },
    { grade: 4, label: 'Yaxshi', from: 71, students: 1304 },
    { grade: 3, label: 'Qoniqarli', from: 55, students: 967 },
    { grade: 2, label: 'Qoniqarsiz', from: 0, students: 713 },
  ],
  by_course: [
    { course: 1, students: 2260, took: 1203, coverage: 53, attempts: 3863, percent: 79 },
    { course: 2, students: 2104, took: 1523, coverage: 72, attempts: 5182, percent: 72 },
    { course: 3, students: 1276, took: 790, coverage: 62, attempts: 3597, percent: 77 },
    { course: 4, students: 875, took: 338, coverage: 39, attempts: 1532, percent: 70 },
    { course: 5, students: 807, took: 250, coverage: 31, attempts: 887, percent: 65 },
    { course: 6, students: 321, took: 1, coverage: 0, attempts: 3, percent: 66 },
  ],
  by_faculty: [
    { faculty: 'Magistratura bo‘limi', students: 952, took: 0, coverage: 0, attempts: 0, percent: null },
    { faculty: 'Pediatriya fakulteti', students: 1744, took: 924, coverage: 53, attempts: 3101, percent: 59 },
    { faculty: 'Davolash ishi fakulteti', students: 2177, took: 1306, coverage: 60, attempts: 4890, percent: 72 },
    { faculty: 'Tibbiy profilaktika va jamoat salomatligi fakulteti', students: 1157, took: 764, coverage: 66, attempts: 2810, percent: 74 },
    { faculty: 'Xalqaro fakultet', students: 1613, took: 1097, coverage: 68, attempts: 4263, percent: 84 },
  ],
  groups: GROUPS.map((g, i) => {
    const students = 14 + (i % 9);
    const took = i === 10 || i === 11 ? 0 : Math.max(0, students - (i * 3) % students);
    return {
      group: g,
      faculty: FACULTIES[i % 5],
      course: (i % 6) + 1,
      lessons: i === 10 || i === 11 ? 0 : 6 + i,
      students,
      took,
      coverage: Math.round((100 * took) / students),
      attempts: took * 3,
      percent: took ? 48 + ((i * 13) % 45) : null,
    };
  }).sort((a, b) => (a.lessons === 0 ? 1 : 0) - (b.lessons === 0 ? 1 : 0) || a.coverage - b.coverage),
  at_risk: Array.from({ length: 14 }, (_, i) => ({
    student_key: `ot_risk${i}`,
    full_name: name(i + 40),
    group_name: GROUPS[(i * 5) % GROUPS.length],
    course: (i % 5) + 1,
    attempts: 3 + (i % 6),
    percent: 24 + i * 2,
  })),
  integrity: {
    attempts: 15064,
    fast: { attempts: 1188, students: 839, seconds_per_question: 8 },
    away: { attempts: 2488, students: 1613, seconds: 30 },
    copy: {
      groups: 61,
      students: 147,
      items: Array.from({ length: 5 }, (_, i) => ({
        date: days[(i + 2) % 7],
        topic: ['Qorin tifi', 'Miokard infarkti', 'Bronxial astma', 'Gipertoniya krizi', 'O‘tkir appenditsit'][i],
        teacher_key: `t${i}`,
        teacher_name: name(i + 80),
        size: 2 + (i % 3),
        students: Array.from({ length: 2 + (i % 3) }, (_, j) => ({
          student_key: `ot_copy${i}${j}`,
          full_name: name(i * 3 + j + 60),
          group_name: GROUPS[i],
          percent: 50 + i * 5,
        })),
      })),
    },
  },
  teachers: Array.from({ length: 22 }, (_, i) => ({
    teacher_key: `t${i}`,
    teacher_name: name(i + 100),
    department: ['Fiziologiya', 'Pediatriya', 'Yuqumli kasalliklar', 'Tibbiy va biologik kimyo', 'Fakultet terapiyasi'][i % 5],
    tests: 33 - i,
    students: 120 - i * 4,
    attempts: 300 - i * 9,
    percent: 52 + ((i * 11) % 45),
    participation: 38 + ((i * 17) % 62),
    low_participation: i % 4 === 0 ? 3 : 0,
    flagged_percent: (i * 7) % 40,
  })),
  by_department: [
    { department: 'Pediatriya', groups: 5, teachers: 3, students: 68, took: 0, coverage: 0, attempts: 0, percent: null },
    { department: 'Ichki kasalliklar propedevtikasi', groups: 3, teachers: 1, students: 43, took: 0, coverage: 0, attempts: 0, percent: null },
    { department: 'Ovqatlanish, bolalar va o‘smirlar gigienasi', groups: 22, teachers: 5, students: 319, took: 70, coverage: 22, attempts: 303, percent: 78 },
    { department: 'Stomatologiya va otorinolaringologiya', groups: 31, teachers: 11, students: 445, took: 114, coverage: 26, attempts: 219, percent: 48 },
    { department: 'Fiziologiya', groups: 57, teachers: 11, students: 822, took: 509, coverage: 62, attempts: 717, percent: 76 },
    { department: 'Yuqumli kasalliklar', groups: 40, teachers: 9, students: 610, took: 480, coverage: 79, attempts: 1500, percent: 81 },
  ],
  rules: { risk_attempts: 3, risk_percent: 55 },
  scope: { kind: 'monitor', department: '', groups: 277, teachers: 111 },
};

const FILTERS = {
  faculties: FACULTIES,
  groups: GROUPS,
  courses: [1, 2, 3, 4, 5, 6],
  subjects: [{ code: 'SUB-1', name: 'Yuqumli kasalliklar' }, { code: 'SUB-2', name: 'Fakultet terapiyasi' }],
  groups_by_faculty: Object.fromEntries(FACULTIES.map((f, i) => [f, GROUPS.filter((_, j) => j % 5 === i)])),
  students_total: 7643,
};

const PLATFORMS = {
  platforms: [
    { key: 'imentor', label: 'Darsga tayyorgarlik (iMentor)', ok: true, link: 'https://imentor.uz', cards: [], note: '' },
    { key: 'itest', label: 'Online imtihon (iTest)', ok: true, link: '', cards: [], note: '' },
    { key: 'icam', label: 'Kamera nazorati (iCam)', ok: false, link: '', cards: [], note: '' },
    { key: 'ishifo', label: 'Teletibbiyot (iShifo)', ok: true, link: '', cards: [], note: '' },
  ],
  missing: [
    { key: 'aishifokor', label: 'AI shifokor (aishifokor.uz)', note: 'bazaga kirish huquqi kerak' },
    { key: 'fermi', label: 'Institut sayti (fermi.uz)', note: 'ochiq API yo‘q' },
  ],
};

const TOPICS = ['Qorin tifi', 'Miokard infarkti', 'Bronxial astma', 'Gipertoniya krizi', 'O‘tkir appenditsit', 'Qandli diabet'];

const ATTEMPTS = {
  student: {
    student_id: '34425100001', full_name: name(1), group_name: 'DI-2725', course: 2,
    faculty: 'Davolash ishi fakulteti', direction: 'Davolash ishi',
  },
  from: '2026-10-09',
  to: '2026-10-15',
  attempts: TOPICS.map((topic, i) => ({
    id: 900 + i,
    date: days[i],
    submitted_at: `${days[i]}T10:3${i}:00+05:00`,
    subject_code: 'SUB-1',
    subject_name: 'Fakultet terapiyasi',
    topic,
    variant: 'A',
    teacher_key: `t${i}`,
    teacher_name: name(i + 100),
    score: [6, 8, 5, 9, 7, 10][i],
    total: 10,
    percent: [60, 80, 50, 90, 70, 100][i],
    minutes: [9, 12, 2, 14, 11, 13][i],
    too_fast: i === 2,
    lesson: { para: `${(i % 4) + 1}-para`, auditorium: `${200 + i}-xona` },
  })),
};

const DETAIL = {
  id: 900,
  student: { student_id: '34425100001', full_name: name(1), group_name: 'DI-2725', course: 2, faculty: 'Davolash ishi fakulteti' },
  date: days[0], submitted_at: `${days[0]}T10:30:00+05:00`, started_at: `${days[0]}T10:20:00+05:00`,
  subject_code: 'SUB-1', topic: 'Qorin tifi', variant: 'A', teacher_key: 't0', teacher_name: name(100),
  score: 2, total: 3, percent: 67, minutes: 9, too_fast: false,
  lesson: { para: '1-para', auditorium: '200-xona' },
  questions: [
    { index: 0, question: '32 yoshli bemor 9 kundan beri isitma, bosh og‘rig‘i va qorinda dam bo‘lishidan shikoyat qiladi. Puls 68/daqiqa, harorat 39,4 °C. Qaysi belgi tashxis uchun hal qiluvchi?', options: ['Nisbiy bradikardiya', 'Yo‘tal', 'Toshma yo‘qligi', 'Bosh og‘rig‘i', 'Qusish'], selected_index: 0, correct_index: 0, is_correct: true, skipped: false, explanation: 'Yuqori isitmada nisbiy bradikardiya qorin tifiga xos.' },
    { index: 1, question: 'Birinchi haftada tashxisni tasdiqlash uchun eng to‘g‘ri tekshiruv qaysi?', options: ['Qon ekilmasi (gemokultura)', 'Vidal reaksiyasi', 'Najas ekilmasi', 'Siydik ekilmasi', 'Qorin UTT'], selected_index: 1, correct_index: 0, is_correct: false, skipped: false, explanation: 'Birinchi haftada gemokultura eng sezgir usul.' },
    { index: 2, question: 'Qaysi asorat 3-haftada eng xavfli hisoblanadi?', options: ['Ichak perforatsiyasi', 'Pnevmoniya', 'Miokardit', 'Xoletsistit', 'Osteomiyelit'], selected_index: null, correct_index: 0, is_correct: false, skipped: true, explanation: '' },
  ],
  events: [
    { type: 'answer_select', question_index: 0, at: `${days[0]}T10:21:00+05:00` },
    { type: 'visibility_hidden', question_index: null, at: `${days[0]}T10:23:00+05:00` },
    { type: 'visibility_visible', question_index: null, at: `${days[0]}T10:23:48+05:00` },
  ],
};

const WEEKS = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];
const STUDENTS_TREND = {
  from: WEEKS[0],
  to: '2026-10-15',
  weeks: WEEKS.map((w, i) => ({
    week_start: w, week_end: w,
    students: [0, 0, 12, 3137, 3173, 3264, 3570, 3831][i],
    took: [0, 0, 0, 464, 687, 926, 1591, 2169][i],
    coverage: [null, null, 0, 15, 22, 28, 45, 57][i],
    attempts: [0, 0, 0, 1200, 2100, 2900, 5200, 6158][i],
    percent: [null, null, null, 59, 57, 57, 63, 74][i],
  })),
};

// Natijalar arxivi (2026-10-23): o'rtacha baho va bilim dinamikasi.
const TREND_CYCLE = ['up', 'down', 'flat', 'few', 'up', 'flat', 'down'] as const;
const ARCHIVE = {
  from: '2026-10-09',
  to: '2026-10-15',
  year_from: '2026-09-01',
  headline: {
    students: 4143, tested: 3177, never: 966, results: 8087, percent: 79,
    grades: { '5': 1364, '4': 905, '3': 529, '2': 379 },
    trend: { up: 1111, down: 344, flat: 361, few: 2327 },
  },
  students: Array.from({ length: 40 }, (_, i) => {
    const tests = i % 9 === 4 ? 0 : (i % 5) + 1;
    const percent = tests ? 45 + ((i * 17) % 55) : null;
    const trend = TREND_CYCLE[i % TREND_CYCLE.length];
    return {
      student_key: `ot_${34425100000 + i}`, student_id: String(34425100000 + i), full_name: name(i),
      group_name: GROUPS[i % GROUPS.length], course: (i % 5) + 1, faculty: FACULTIES[i % FACULTIES.length],
      tests, percent, grade: percent === null ? null : percent >= 86 ? 5 : percent >= 71 ? 4 : percent >= 55 ? 3 : 2,
      trend, trend_delta: trend === 'few' ? null : trend === 'up' ? 12 + (i % 20) : trend === 'down' ? -(10 + (i % 25)) : (i % 7) - 3,
      subjects: (i % 4) + 1, falling_subjects: trend === 'down' ? 1 : i % 6 === 0 ? 1 : 0,
      year_tests: tests * 4 + (i % 7), last_date: tests ? days[i % days.length] : null,
    };
  }),
};
const SUBJECT_RESULTS = (subject: string, base: number, step: number, n: number, ids = 0) => Array.from({ length: n }, (_, k) => {
  const percent = Math.max(20, Math.min(100, base + step * k + ((k * 13) % 9) - 4));
  return {
    attempt_id: 5000 + ids + k, date: `2026-${k < 4 ? '09' : '10'}-${String(8 + k * 3 > 30 ? (8 + k * 3) - 29 : 8 + k * 3).padStart(2, '0')}`,
    para: `${(k % 4) + 1}-para`, topic: `${subject}: ${TOPICS[k % TOPICS.length]}`, teacher: name(100 + k),
    score: Math.round(percent / 10), total: 10, percent, grade: percent >= 86 ? 5 : percent >= 71 ? 4 : percent >= 55 ? 3 : 2,
  };
}).reverse();
const ARCHIVE_PROFILE = {
  student: {
    student_key: 'ot_34425100001', student_id: '34425100001', full_name: name(1), group_name: 'DI-2725', course: 2,
    faculty: 'Davolash ishi fakulteti', direction: 'Davolash ishi', status: 'active',
  },
  year_from: '2026-09-01',
  to: '2026-10-15',
  summary: { tests: 19, percent: 71, grade: 4, trend: 'down', trend_delta: -11, subjects: 3, falling_subjects: 1 },
  weeks: ['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'].map((w, i) => (
    { week_start: w, percent: [82, 79, 76, 70, 66, 63][i], tests: [3, 4, 3, 3, 4, 2][i] })),
  subjects: [
    { subject: 'Normal fiziologiya', department: 'Fiziologiya', tests: 8, percent: 66, grade: 3, trend: 'down', trend_delta: -24,
      first_date: '2026-09-08', last_date: '2026-10-14', results: SUBJECT_RESULTS('Fiziologiya', 88, -6, 8) },
    { subject: 'Biokimyo', department: 'Tibbiy va biologik kimyo', tests: 7, percent: 78, grade: 4, trend: 'up', trend_delta: 18,
      first_date: '2026-09-09', last_date: '2026-10-13', results: SUBJECT_RESULTS('Biokimyo', 62, 5, 7, 100) },
    { subject: 'Odam anatomiyasi', department: 'Yu.Nishanov nomidagi Normal anatomiya', tests: 2, percent: 80, grade: 4, trend: 'few', trend_delta: null,
      first_date: '2026-10-07', last_date: '2026-10-14', results: SUBJECT_RESULTS('Anatomiya', 78, 4, 2, 200) },
  ],
};

// «HEMIS'da baho bor, iMentor ochilmagan» (2026-11-16) — to'qima ro'yxat.
const GRADED = {
  ready: true, at: '2026-10-15T14:30:00Z', scan_from: '2026-10-02', scan_to: '2026-10-15', checked: 120, partial: false,
  items: Array.from({ length: 9 }, (_, i) => ({
    lesson_id: 900 + i, date: days[i % days.length], weekday: 'Dushanba', para: `${1 + (i % 5)}-para`, start_time: '08:00', end_time: '09:20',
    teacher_name: name(i % 4), teacher_key: `t${i % 4}`, department: 'Normal fiziologiya', subject: 'Normal fiziologiya',
    group: GROUPS[i % GROUPS.length], groups: [GROUPS[i % GROUPS.length]], room: `${30 + i}-xona`, lesson_type: 'Amaliy', graded: 6 + i, roster: 16,
  })),
};

const ROUTES: Array<[RegExp, unknown]> = [
  [/\/rector\/control\/graded-not-opened\//, GRADED],
  [/\/rector\/students-archive\/[^/?]+\//, ARCHIVE_PROFILE],
  [/\/rector\/students-archive\/\?/, ARCHIVE],
  [/\/rector\/students-report\/trend\//, STUDENTS_TREND],
  [/\/rector\/students-report\/attempt\/\d+\//, DETAIL],
  [/\/rector\/students-report\/[^/]+\/attempts\//, ATTEMPTS],
  [/\/rector\/students-report\/overview\//, OVERVIEW],
  [/\/rector\/students-report\/filters\//, FILTERS],
  [/\/rector\/students-report\/\?/, STUDENTS],
  // Batafsil sahifa (2026-11-15) — raqam ortidagi o'qituvchilar.
  [/\/rector\/control\/people\//, {
    metric: 't_partial', title: 'Ba’zi darsini o‘tgan', kind: 'teacher', total: 3,
    people: [
      { key: 'a', kind: 'teacher', name: 'MADRAXIMOVA N. R.', subtitle: 'Yu. Nishonov nomidagi Normal anatomiya', value: 12, value_label: '/ 29 dars', note: '' },
      { key: 'b', kind: 'teacher', name: 'MAXMUDOVA M. A.', subtitle: 'Fakultativ terapiya (UASH)', value: 20, value_label: '/ 24 dars', note: '' },
      { key: 'c', kind: 'teacher', name: 'ALIMOVA I. A.', subtitle: 'Pediatriya', value: 3, value_label: '/ 24 dars', note: 'ta’tilda' },
    ],
  }],
  [/\/rector\/control\/\?/, CONTROL],
  [/\/rector\/platforms\//, PLATFORMS],
  [/\/rector\/filters\//, { departments: ['Fiziologiya', 'Pediatriya', 'Yuqumli kasalliklar'], scope: { groups: [] } }],
];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  for (const [pattern, body] of ROUTES) {
    if (pattern.test(url)) {
      await new Promise((r) => setTimeout(r, 250));
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }
  if (url.includes('/api/')) {
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof window.fetch;

try {
  localStorage.setItem('imentor-rector-token-v1', 'harness-fixture');
} catch {
  /* xususiy oyna — kirish oynasi ko'rinadi */
}

createRoot(document.getElementById('root')!).render(<RectorApp />);
