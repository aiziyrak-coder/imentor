/**
 * `imentor.uz/taqdimot` — boshqa universitet rektorlari va hamkorlarga iMentor taqdimoti.
 *
 * 2026-11-13: landing-sahifa ko'rinishidan HAQIQIY SLAYD-TAQDIMOTGA o'tkazildi (foydalanuvchi talabi: "matn
 * juda ko'p, haqiqiy professional taqdimotdek bo'lsin"). Har slayd: bitta katta sarlavha, 2–4 qisqa band va
 * o'ngda interfeys bo'lagi. Matn shu faylda, uch tilda; slaydlar soni va tartibi uchala tilda bir xil.
 *
 * Raqamlar FJSTI bazasidan JAMLANGAN holda olingan (ism yoki shaxsiy ma'lumot yo'q) va `PITCH_STATS.asOf`
 * sanasiga qotirilgan — sahifa serverga so'rov yubormaydi. Yangilash: scratchpad `pitch_stats.py`.
 * Interfeys bo'laklaridagi ism va raqamlar — namunaviy (shartli), haqiqiy shaxs emas.
 */

export type PitchLang = 'uz' | 'ru' | 'en';

export const PITCH_STATS = {
  asOf: '2026-11-11',
  since: '2026-09-09',
  monthLessons: 7203,
  monthPercent: 85,
  monthTeachersWatched: 252,
  monthTeachersUsed: 233,
  lectures: 7700,
  tests: 7259,
  presentations: 6400,
  cases: 6356,
  handouts: 37387,
  videos: 3471,
  liveSessions: 12004,
  liveSubmissions: 106299,
  books: 426,
  protocols: 87,
  departments: 40,
  syllabi: 830,
  topics: 23804,
  monitors: 105,
  studentsActive: 5834,
  students: 7739,
};

/** Slayd turi — qaysi interfeys bo'lagi chiziladi. */
export type SlideKind =
  | 'title' | 'stats' | 'problems' | 'how' | 'teacher' | 'quality' | 'live' | 'student'
  | 'rector' | 'reasons' | 'languages' | 'security' | 'modules' | 'rollout' | 'closing';

export interface DeckSlide {
  kind: SlideKind;
  /** Pastki satrdagi bo'lim nomi va yuqoridagi kicker. */
  section: string;
  /** Sarlavha; `[[...]]` ichidagi qism rangli ajratiladi. */
  title: string;
  lead?: string;
  bullets?: string[];
  /** Muammo → javob juftliklari (problems). */
  pairs?: { problem: string; answer: string }[];
  /** Qadamlar (how, rollout). */
  steps?: { title: string; text: string; value: string }[];
  /** Raqamlar (stats): `PITCH_STATS` kaliti va izoh. */
  stats?: { key: keyof typeof PITCH_STATS; label: string; suffix?: string }[];
  /** Modullar (modules). */
  modules?: string[];
  note?: string;
  /** Taqdimotchi uchun izoh (N tugmasi). */
  notes?: string;
  /** Interfeys bo'lagidagi yozuvlar (har slayd o'zinikini ishlatadi). */
  ui?: Record<string, string>;
}

export interface DeckText {
  langName: string;
  brand: string;
  hint: string;
  fullscreen: string;
  exitFullscreen: string;
  enter: string;
  prev: string;
  next: string;
  asOf: string;
  slides: DeckSlide[];
}

const uz: DeckText = {
  langName: "O'zbekcha",
  brand: 'iMENTOR',
  hint: "← → yoki bo'sh joy · F — to'liq ekran",
  fullscreen: "To'liq ekran",
  exitFullscreen: 'Chiqish',
  enter: 'Kirish',
  prev: 'Oldingi slayd',
  next: 'Keyingi slayd',
  asOf: 'Holat',
  slides: [
    {
      kind: 'title',
      section: 'Titul',
      title: "Har bir dars — zamonaviy. Har bir natija — [[ko'rinadi.]]",
      lead: "Tibbiyot oliy ta'limi uchun sun'iy intellekt platformasi.",
      note: "Farg'ona jamoat salomatligi tibbiyot instituti · hamkorlar uchun taqdimot",
      ui: {
        kicker: 'iMENTOR · FJSTI · NOYABR 2026', topic: 'Miokard infarkti · 4-kurs', ready: 'tayyor',
        lecture: "Ma'ruza matni", slides: 'Taqdimot · 18 slayd', case: 'Klinik keys', test: 'Test · 10 savol',
        source: 'Manba: kafedra darsligi · klinik protokol', live: 'Darsda: 28 / 30 talaba javob berdi',
        rector: 'Rektor: dars hisobga olindi',
      },
    },
    {
      kind: 'stats',
      section: 'Natija',
      title: "Ikki oyda — [[har kungi odat.]]",
      lead: "FJSTI'da 2026-yil 9-sentabrdan beri. Faqat jamlangan sonlar.",
      stats: [
        { key: 'monthPercent', label: "ekranli auditoriyadagi darslar iMentor bilan o'tadi", suffix: '%' },
        { key: 'monthLessons', label: 'dars oxirgi 4 haftada nazoratda' },
        { key: 'monthTeachersUsed', label: "o'qituvchi har oy ishlatadi" },
        { key: 'tests', label: 'test tayyorlangan' },
        { key: 'liveSubmissions', label: 'talaba javobi qabul qilingan' },
        { key: 'studentsActive', label: 'faol talaba (30 kun)' },
      ],
    },
    {
      kind: 'problems',
      section: 'Muammo → javob',
      title: "Olti kundalik muammo. Har biriga [[aniq javob.]]",
      pairs: [
        { problem: 'Darsga tayyorgarlik — soatlab', answer: "Ma'ruza, slayd, keys, test — daqiqalarda" },
        { problem: "Darslar qanday o'tayotgani noma'lum", answer: 'HEMIS jadvali bilan avtomatik nazorat' },
        { problem: '"Ekran ishlamadi" — tekshirib bo\'lmaydi', answer: 'Har holatga sabab va dalil' },
        { problem: "Test ko'chiriladi, natija kechikadi", answer: 'Savol — monitorda, javob — telefonda' },
        { problem: "Uch tildagi guruh — uch marta ish", answer: 'Bir marta yaratiladi, uch tilda ishlaydi' },
        { problem: "AI o'ylab topadi", answer: 'Darslik va klinik protokolga tayanadi' },
      ],
    },
    {
      kind: 'how',
      section: 'Qanday ishlaydi',
      title: "Bir dars — [[to'rt qadam.]]",
      steps: [
        { title: 'Jadval', text: "Dars jadvali HEMIS'dan o'zi keladi", value: 'har 10 daq.' },
        { title: 'Tayyorgarlik', text: 'Mavzu tanlanadi — material tayyor', value: '3–5 daqiqa' },
        { title: 'Dars', text: 'Ekranda taqdimot, telefonda test', value: '80 daqiqa' },
        { title: 'Hisobot', text: 'Rektorda — dalil bilan', value: 'darhol' },
      ],
    },
    {
      kind: 'teacher',
      section: "O'qituvchi",
      title: "Darsga tayyorgarlik — [[daqiqalarda.]]",
      bullets: [
        "Ma'ruza, taqdimot, klinik keys va test — bitta oynada",
        'Taqdimot PowerPoint faylga animatsiyalari bilan',
        "O'qituvchi tahrirlaydi — yakuniy so'z unda",
      ],
      ui: {
        head: 'Mavzu bo\'yicha material', topic: 'Miokard infarkti: tashxis va davolash',
        lecture: "Ma'ruza matni", lectureMeta: '12 bet · 9 ta manba', slides: 'Taqdimot', slidesMeta: '18 slayd · PPTX',
        case: 'Klinik keys', caseMeta: 'bemor · tahlillar · yechim', test: 'Test', testMeta: '4 qiyin · 4 o\'rta · 2 oson',
        time: '3 daq 40 s',
      },
    },
    {
      kind: 'quality',
      section: 'Sifat',
      title: "Sun'iy intellekt [[o'ylab topmaydi.]]",
      bullets: [
        "Har matn kafedra darsligiga tayanadi — manba ko'rsatiladi",
        'Klinik kafedralarda milliy protokol — majburiy',
        'Mavzu, til va savol sifati avtomatik tekshiriladi',
      ],
      ui: {
        head: "Ma'ruza · 3-bo'lim",
        p1: "O'tkir koronar sindromda birinchi 10 daqiqada 12 ulanishli EKG olinadi",
        p2: "va troponin darajasi aniqlanadi; reperfuziya usuli bemor holatiga ko'ra tanlanadi",
        c1: 'Darslik, 214-bet', c2: 'Klinik protokol', ok1: 'Mavzuga mos', ok2: "Til: o'zbek", ok3: 'Manbali',
        books: 'darslik', protocols: 'protokol',
      },
    },
    {
      kind: 'live',
      section: 'Jonli test',
      title: 'Savol — ekranda. [[Javob — telefonda.]]',
      bullets: [
        "1 daqiqa o'qish, 1 daqiqa belgilash — hamma bir vaqtda",
        "Telefonda savol matni yo'q — AI'dan so'rab bo'lmaydi",
        'Test o\'zi yopiladi, natija — darhol',
      ],
      ui: {
        q: 'Savol 3 / 10', question: "ST elevatsiyali miokard infarktida reperfuziyaning afzal usuli qaysi?",
        answered: 'Javob berdi: 27 / 30', mark: 'Javobni belgilang!', phone: 'Monitorga qarang',
      },
    },
    {
      kind: 'student',
      section: 'Talaba va ota-ona',
      title: "Parolsiz kirish. [[Ota‑onaga — xabar.]]",
      bullets: [
        'Yuz, JSHSHIR yoki talaba ID bilan — parol kerak emas',
        'Har natija arxivda: fan, mavzu, o\'sish dinamikasi',
        "Ota-ona natijani Telegram'da oladi",
      ],
      ui: {
        bot: 'iMentor · ota-onalar', msg: "Farzandingiz bugun «Kardiologiya» fanidan test topshirdi", score: '8 / 10',
        topic: 'Mavzu: Miokard infarkti', daily: 'Kunlik hisobot 19:00 da', face: 'Yuz tasdiqlandi',
      },
    },
    {
      kind: 'rector',
      section: 'Rektor nazorati',
      title: 'Taxmin emas — [[dalil.]]',
      bullets: [
        "Kafedra, auditoriya va o'qituvchi kesimida",
        'Har raqam ortida — aniq ro\'yxat',
        'Dars tugashi bilan yangilanadi',
      ],
      ui: {
        head: 'Haftalik ko\'rinish', sub: 'ekranli auditoriyadagi darslar',
        d1: 'Ichki kasalliklar', d2: 'Pediatriya', d3: 'Jarrohlik', d4: 'Farmakologiya', d5: 'Anatomiya',
        total: 'Institut bo\'yicha',
      },
    },
    {
      kind: 'reasons',
      section: 'Sabab va dalil',
      title: 'Har "o\'tmadi" ortida — [[sabab.]]',
      bullets: [
        'Xona ekrani shu kuni ishlaganmi — tizim ko\'radi',
        "O'qituvchi kirganmi, necha daqiqa ishlagan",
        'Tasdiqlangan kasallik varaqasi — ayb emas',
      ],
      ui: {
        head: "O'qituvchi A · 13-noyabr",
        r1: '2-para · 304-xona', s1: 'O\'tdi · 52 daqiqa',
        r2: '3-para · 211-xona', s2: 'Ekran nosoz — xonani tekshirish',
        r3: '4-para · 118-xona', s3: 'Kasallik varaqasi tasdiqlangan',
        r4: '5-para · 402-xona', s4: 'Hisobga kirmagan',
      },
    },
    {
      kind: 'languages',
      section: 'Uch til',
      title: 'Bir marta yarating — [[uch tilda o\'qiting.]]',
      bullets: [
        'Interfeys, fan mavzulari va materiallar — uz · ru · en',
        "Xalqaro talabalar o'z tilida o'qiydi",
        'Tarjima tili avtomatik tekshiriladi',
      ],
      ui: { topics: 'fan mavzusi — uch tilda' },
    },
    {
      kind: 'security',
      section: 'Xavfsizlik va iqtisod',
      title: "Ma'lumot — universitetda. [[Xarajat — nazoratda.]]",
      bullets: [
        "HEMIS'dan faqat o'qiydi — hech narsa yozmaydi",
        "AI'ga shaxsiy ma'lumot yuborilmaydi",
        "Har testda 8 savol — tekshirilgan bankdan: xarajat bir necha barobar kam",
      ],
      ui: {
        server: 'Universitet serveri', l1: 'Dars jadvali · xodimlar · talabalar', l1b: "HEMIS — faqat o'qish",
        l2: 'Yuz shablonlari', l2b: "faqat o'qish", l3: 'AI so\'rovi', l3b: 'mavzu + darslik parchasi',
        cost: 'AI xarajati paneli', bank: 'bankdan', fresh: 'yangi',
      },
    },
    {
      kind: 'modules',
      section: 'Modullar',
      title: "Bitta platforma — [[butun o'quv jarayoni.]]",
      modules: [
        "Ma'ruza generatori", 'Taqdimot · PPTX', 'Klinik keys', 'Test va savollar banki',
        'Monitor rejimidagi jonli test', 'Kafedra kutubxonasi', 'Klinik protokollar', 'Rektor monitoringi',
        'Talabalar natijalari arxivi', 'Ota-onalar boti', 'Yuz orqali kirish', 'HEMIS integratsiyasi',
      ],
    },
    {
      kind: 'rollout',
      section: 'Joriy etish',
      title: "Universitetingizda — [[to'rt bosqich.]]",
      steps: [
        { title: 'Namoyish', text: 'Real darslar, real ekranlar', value: '1 soat' },
        { title: "O'rnatish", text: 'Server, HEMIS, kafedralar, kutubxona', value: '1 hafta' },
        { title: 'Pilot', text: "2–3 kafedra, o'qituvchilarni o'qitish", value: '2 hafta' },
        { title: "To'liq ishga tushirish", text: 'Barcha kafedralar va rektor monitoringi', value: 'birga' },
      ],
    },
    {
      kind: 'closing',
      section: 'Yakun',
      title: "Tayyorgarlik — daqiqalarda. [[Nazorat — dalil bilan.]]",
      lead: "Real universitetda, har kuni minglab darslarda sinovdan o'tgan. Bir oy ichida sizda ham ishlaydi.",
      bullets: ['HEMIS API ruxsati', 'Auditoriya ekranlari', 'Kafedra darsliklari (PDF)'],
      ui: { need: 'Kerak bo\'ladi', site: 'imentor.uz', thanks: 'Rahmat!' },
    },
  ],
};

const ru: DeckText = {
  langName: 'Русский',
  brand: 'iMENTOR',
  hint: '← → или пробел · F — полный экран',
  fullscreen: 'Полный экран',
  exitFullscreen: 'Выйти',
  enter: 'Войти',
  prev: 'Предыдущий слайд',
  next: 'Следующий слайд',
  asOf: 'На',
  slides: [
    {
      kind: 'title',
      section: 'Титул',
      title: 'Каждое занятие — современное. Каждый результат — [[виден.]]',
      lead: 'Платформа искусственного интеллекта для высшего медицинского образования.',
      note: 'Ферганский медицинский институт общественного здоровья · презентация для партнёров',
      ui: {
        kicker: 'iMENTOR · ФМИОЗ · НОЯБРЬ 2026', topic: 'Инфаркт миокарда · 4 курс', ready: 'готово',
        lecture: 'Текст лекции', slides: 'Презентация · 18 слайдов', case: 'Клинический кейс', test: 'Тест · 10 вопросов',
        source: 'Источник: учебник кафедры · клинический протокол', live: 'На занятии: ответили 28 / 30 студентов',
        rector: 'Ректор: занятие засчитано',
      },
    },
    {
      kind: 'stats',
      section: 'Результат',
      title: 'Два месяца — и [[это ежедневная практика.]]',
      lead: 'В ФМИОЗ с 9 сентября 2026 года. Только агрегированные данные.',
      stats: [
        { key: 'monthPercent', label: 'занятий в аудиториях с экраном проходят с iMentor', suffix: '%' },
        { key: 'monthLessons', label: 'занятий под контролем за 4 недели' },
        { key: 'monthTeachersUsed', label: 'преподавателей пользуются каждый месяц' },
        { key: 'tests', label: 'тестов подготовлено' },
        { key: 'liveSubmissions', label: 'ответов студентов принято' },
        { key: 'studentsActive', label: 'активных студентов (30 дней)' },
      ],
    },
    {
      kind: 'problems',
      section: 'Проблема → ответ',
      title: 'Шесть ежедневных проблем. На каждую — [[точный ответ.]]',
      pairs: [
        { problem: 'Подготовка к занятию — часами', answer: 'Лекция, слайды, кейс, тест — за минуты' },
        { problem: 'Неизвестно, как проходят занятия', answer: 'Автоматический контроль по расписанию HEMIS' },
        { problem: '«Экран не работал» — не проверить', answer: 'У каждого случая — причина и доказательство' },
        { problem: 'Тесты списывают, результат опаздывает', answer: 'Вопрос — на мониторе, ответ — в телефоне' },
        { problem: 'Группы на трёх языках — тройная работа', answer: 'Создаётся один раз, работает на трёх языках' },
        { problem: 'ИИ выдумывает', answer: 'Опирается на учебник и клинический протокол' },
      ],
    },
    {
      kind: 'how',
      section: 'Как это работает',
      title: 'Одно занятие — [[четыре шага.]]',
      steps: [
        { title: 'Расписание', text: 'Расписание приходит из HEMIS само', value: 'каждые 10 мин' },
        { title: 'Подготовка', text: 'Выбрана тема — материал готов', value: '3–5 минут' },
        { title: 'Занятие', text: 'На экране презентация, в телефоне тест', value: '80 минут' },
        { title: 'Отчёт', text: 'У ректора — с доказательствами', value: 'сразу' },
      ],
    },
    {
      kind: 'teacher',
      section: 'Преподаватель',
      title: 'Подготовка к занятию — [[за минуты.]]',
      bullets: [
        'Лекция, презентация, клинический кейс и тест — в одном окне',
        'Презентация в PowerPoint вместе с анимацией',
        'Преподаватель редактирует — последнее слово за ним',
      ],
      ui: {
        head: 'Материал по теме', topic: 'Инфаркт миокарда: диагностика и лечение',
        lecture: 'Текст лекции', lectureMeta: '12 страниц · 9 источников', slides: 'Презентация', slidesMeta: '18 слайдов · PPTX',
        case: 'Клинический кейс', caseMeta: 'пациент · анализы · решение', test: 'Тест', testMeta: '4 сложных · 4 средних · 2 лёгких',
        time: '3 мин 40 с',
      },
    },
    {
      kind: 'quality',
      section: 'Качество',
      title: 'Искусственный интеллект [[не выдумывает.]]',
      bullets: [
        'Каждый текст опирается на учебник кафедры — с указанием источника',
        'На клинических кафедрах национальный протокол — обязателен',
        'Тема, язык и качество вопросов проверяются автоматически',
      ],
      ui: {
        head: 'Лекция · раздел 3',
        p1: 'При остром коронарном синдроме в первые 10 минут регистрируется ЭКГ в 12 отведениях',
        p2: 'и определяется уровень тропонина; метод реперфузии выбирается по состоянию пациента',
        c1: 'Учебник, с. 214', c2: 'Клинический протокол', ok1: 'Соответствует теме', ok2: 'Язык: русский', ok3: 'С источниками',
        books: 'учебников', protocols: 'протоколов',
      },
    },
    {
      kind: 'live',
      section: 'Живой тест',
      title: 'Вопрос — на экране. [[Ответ — в телефоне.]]',
      bullets: [
        'Минута на чтение, минута на ответ — все одновременно',
        'В телефоне нет текста вопроса — спросить у ИИ нельзя',
        'Тест закрывается сам, результат — сразу',
      ],
      ui: {
        q: 'Вопрос 3 / 10', question: 'Какой метод реперфузии предпочтителен при инфаркте миокарда с подъёмом ST?',
        answered: 'Ответили: 27 / 30', mark: 'Отметьте ответ!', phone: 'Смотрите на монитор',
      },
    },
    {
      kind: 'student',
      section: 'Студент и родители',
      title: 'Вход без пароля. [[Родителям — уведомление.]]',
      bullets: [
        'По лицу, ПИНФЛ или ID студента — пароль не нужен',
        'Каждый результат в архиве: предмет, тема, динамика',
        'Родители получают результат в Telegram',
      ],
      ui: {
        bot: 'iMentor · для родителей', msg: 'Ваш ребёнок сегодня сдал тест по «Кардиологии»', score: '8 / 10',
        topic: 'Тема: Инфаркт миокарда', daily: 'Ежедневный отчёт в 19:00', face: 'Лицо подтверждено',
      },
    },
    {
      kind: 'rector',
      section: 'Контроль ректора',
      title: 'Не догадки — [[доказательства.]]',
      bullets: [
        'В разрезе кафедр, аудиторий и преподавателей',
        'За каждой цифрой — конкретный список',
        'Обновляется сразу после занятия',
      ],
      ui: {
        head: 'Неделя', sub: 'занятия в аудиториях с экраном',
        d1: 'Внутренние болезни', d2: 'Педиатрия', d3: 'Хирургия', d4: 'Фармакология', d5: 'Анатомия',
        total: 'По институту',
      },
    },
    {
      kind: 'reasons',
      section: 'Причина и доказательство',
      title: 'За каждым «не проведено» — [[причина.]]',
      bullets: [
        'Работал ли экран аудитории в этот день — система видит',
        'Входил ли преподаватель, сколько минут работал',
        'Подтверждённый больничный — не вина',
      ],
      ui: {
        head: 'Преподаватель А · 13 ноября',
        r1: '2 пара · ауд. 304', s1: 'Проведено · 52 минуты',
        r2: '3 пара · ауд. 211', s2: 'Экран неисправен — проверить аудиторию',
        r3: '4 пара · ауд. 118', s3: 'Больничный подтверждён',
        r4: '5 пара · ауд. 402', s4: 'Не входил в систему',
      },
    },
    {
      kind: 'languages',
      section: 'Три языка',
      title: 'Создайте один раз — [[преподавайте на трёх языках.]]',
      bullets: [
        'Интерфейс, темы и материалы — uz · ru · en',
        'Иностранные студенты учатся на своём языке',
        'Язык перевода проверяется автоматически',
      ],
      ui: { topics: 'тем дисциплин — на трёх языках' },
    },
    {
      kind: 'security',
      section: 'Безопасность и экономия',
      title: 'Данные — в университете. [[Расходы — под контролем.]]',
      bullets: [
        'Из HEMIS только читает — ничего не записывает',
        'Персональные данные в ИИ не отправляются',
        'В каждом тесте 8 вопросов — из проверенного банка: расходы в разы ниже',
      ],
      ui: {
        server: 'Сервер университета', l1: 'Расписание · сотрудники · студенты', l1b: 'HEMIS — только чтение',
        l2: 'Шаблоны лиц', l2b: 'только чтение', l3: 'Запрос к ИИ', l3b: 'тема + фрагмент учебника',
        cost: 'Панель расходов на ИИ', bank: 'из банка', fresh: 'новые',
      },
    },
    {
      kind: 'modules',
      section: 'Модули',
      title: 'Одна платформа — [[весь учебный процесс.]]',
      modules: [
        'Генератор лекций', 'Презентации · PPTX', 'Клинические кейсы', 'Тесты и банк вопросов',
        'Живой тест на мониторе', 'Библиотека кафедры', 'Клинические протоколы', 'Мониторинг ректора',
        'Архив результатов студентов', 'Бот для родителей', 'Вход по лицу', 'Интеграция с HEMIS',
      ],
    },
    {
      kind: 'rollout',
      section: 'Внедрение',
      title: 'В вашем университете — [[четыре этапа.]]',
      steps: [
        { title: 'Демонстрация', text: 'Реальные занятия, реальные экраны', value: '1 час' },
        { title: 'Установка', text: 'Сервер, HEMIS, кафедры, библиотека', value: '1 неделя' },
        { title: 'Пилот', text: '2–3 кафедры, обучение преподавателей', value: '2 недели' },
        { title: 'Полный запуск', text: 'Все кафедры и мониторинг ректора', value: 'вместе' },
      ],
    },
    {
      kind: 'closing',
      section: 'Итог',
      title: 'Подготовка — за минуты. [[Контроль — с доказательствами.]]',
      lead: 'Проверено в реальном университете на тысячах занятий каждый день. У вас заработает за месяц.',
      bullets: ['Доступ к API HEMIS', 'Экраны в аудиториях', 'Учебники кафедр (PDF)'],
      ui: { need: 'Потребуется', site: 'imentor.uz', thanks: 'Спасибо!' },
    },
  ],
};

const en: DeckText = {
  langName: 'English',
  brand: 'iMENTOR',
  hint: '← → or space · F — full screen',
  fullscreen: 'Full screen',
  exitFullscreen: 'Exit',
  enter: 'Sign in',
  prev: 'Previous slide',
  next: 'Next slide',
  asOf: 'As of',
  slides: [
    {
      kind: 'title',
      section: 'Title',
      title: 'Every class — modern. Every result — [[visible.]]',
      lead: 'An AI platform for higher medical education.',
      note: 'Fergana Medical Institute of Public Health · presentation for partners',
      ui: {
        kicker: 'iMENTOR · FMIPH · NOVEMBER 2026', topic: 'Myocardial infarction · year 4', ready: 'ready',
        lecture: 'Lecture text', slides: 'Slides · 18', case: 'Clinical case', test: 'Test · 10 questions',
        source: 'Source: department textbook · clinical protocol', live: 'In class: 28 / 30 students answered',
        rector: 'Rector: class counted',
      },
    },
    {
      kind: 'stats',
      section: 'Results',
      title: 'Two months in — [[a daily habit.]]',
      lead: 'At FMIPH since 9 September 2026. Aggregate figures only.',
      stats: [
        { key: 'monthPercent', label: 'of classes in rooms with a screen run on iMentor', suffix: '%' },
        { key: 'monthLessons', label: 'classes monitored in the last 4 weeks' },
        { key: 'monthTeachersUsed', label: 'teachers use it every month' },
        { key: 'tests', label: 'tests prepared' },
        { key: 'liveSubmissions', label: 'student answers received' },
        { key: 'studentsActive', label: 'active students (30 days)' },
      ],
    },
    {
      kind: 'problems',
      section: 'Problem → answer',
      title: 'Six everyday problems. Each with [[a clear answer.]]',
      pairs: [
        { problem: 'Class preparation takes hours', answer: 'Lecture, slides, case, test — in minutes' },
        { problem: 'Nobody knows how classes really go', answer: 'Automatic monitoring from the HEMIS timetable' },
        { problem: '"The screen was broken" — unverifiable', answer: 'Every case has a reason and evidence' },
        { problem: 'Tests get copied, results come late', answer: 'Question on the monitor, answer on the phone' },
        { problem: 'Three languages — three times the work', answer: 'Created once, works in three languages' },
        { problem: 'AI makes things up', answer: 'Grounded in the textbook and clinical protocol' },
      ],
    },
    {
      kind: 'how',
      section: 'How it works',
      title: 'One class — [[four steps.]]',
      steps: [
        { title: 'Timetable', text: 'Comes from HEMIS automatically', value: 'every 10 min' },
        { title: 'Preparation', text: 'Pick a topic — material is ready', value: '3–5 minutes' },
        { title: 'Class', text: 'Slides on screen, test on phones', value: '80 minutes' },
        { title: 'Report', text: 'The rector sees evidence', value: 'instantly' },
      ],
    },
    {
      kind: 'teacher',
      section: 'Teacher',
      title: 'Class preparation — [[in minutes.]]',
      bullets: [
        'Lecture, slides, clinical case and test — in one place',
        'Slides export to PowerPoint with animations',
        'The teacher edits — and has the final say',
      ],
      ui: {
        head: 'Material for the topic', topic: 'Myocardial infarction: diagnosis and treatment',
        lecture: 'Lecture text', lectureMeta: '12 pages · 9 sources', slides: 'Slides', slidesMeta: '18 slides · PPTX',
        case: 'Clinical case', caseMeta: 'patient · labs · solution', test: 'Test', testMeta: '4 hard · 4 medium · 2 easy',
        time: '3 min 40 s',
      },
    },
    {
      kind: 'quality',
      section: 'Quality',
      title: 'The AI [[does not make things up.]]',
      bullets: [
        'Every text is grounded in a department textbook — with the source',
        'Clinical departments: the national protocol is mandatory',
        'Topic, language and question quality are checked automatically',
      ],
      ui: {
        head: 'Lecture · section 3',
        p1: 'In acute coronary syndrome a 12-lead ECG is recorded within the first 10 minutes',
        p2: 'and troponin is measured; the reperfusion method depends on the patient’s condition',
        c1: 'Textbook, p. 214', c2: 'Clinical protocol', ok1: 'On topic', ok2: 'Language: English', ok3: 'Sourced',
        books: 'textbooks', protocols: 'protocols',
      },
    },
    {
      kind: 'live',
      section: 'Live test',
      title: 'Question on the screen. [[Answer on the phone.]]',
      bullets: [
        'A minute to read, a minute to answer — all at once',
        'No question text on the phone — nothing to ask an AI',
        'The test closes itself, results are instant',
      ],
      ui: {
        q: 'Question 3 / 10', question: 'What is the preferred reperfusion strategy in ST-elevation myocardial infarction?',
        answered: 'Answered: 27 / 30', mark: 'Mark your answer!', phone: 'Look at the monitor',
      },
    },
    {
      kind: 'student',
      section: 'Students and parents',
      title: 'No passwords. [[Parents get notified.]]',
      bullets: [
        'Face, national ID or student ID — no password',
        'Every result is archived: subject, topic, progress',
        'Parents receive results in Telegram',
      ],
      ui: {
        bot: 'iMentor · for parents', msg: 'Your child took a Cardiology test today', score: '8 / 10',
        topic: 'Topic: Myocardial infarction', daily: 'Daily report at 19:00', face: 'Face verified',
      },
    },
    {
      kind: 'rector',
      section: 'Rector oversight',
      title: 'Not guesses — [[evidence.]]',
      bullets: [
        'By department, room and teacher',
        'Behind every number — the exact list',
        'Updated as soon as the class ends',
      ],
      ui: {
        head: 'This week', sub: 'classes in rooms with a screen',
        d1: 'Internal medicine', d2: 'Pediatrics', d3: 'Surgery', d4: 'Pharmacology', d5: 'Anatomy',
        total: 'Institute total',
      },
    },
    {
      kind: 'reasons',
      section: 'Reason and evidence',
      title: 'Behind every "not held" — [[a reason.]]',
      bullets: [
        'Did the room screen work that day — the system knows',
        'Did the teacher sign in, how many minutes they worked',
        'An approved sick note is not a fault',
      ],
      ui: {
        head: 'Teacher A · 13 November',
        r1: 'Period 2 · room 304', s1: 'Held · 52 minutes',
        r2: 'Period 3 · room 211', s2: 'Screen faulty — check the room',
        r3: 'Period 4 · room 118', s3: 'Sick note approved',
        r4: 'Period 5 · room 402', s4: 'Did not sign in',
      },
    },
    {
      kind: 'languages',
      section: 'Three languages',
      title: 'Create once — [[teach in three languages.]]',
      bullets: [
        'Interface, topics and materials — uz · ru · en',
        'International students learn in their language',
        'Translation language is checked automatically',
      ],
      ui: { topics: 'course topics — in three languages' },
    },
    {
      kind: 'security',
      section: 'Security and cost',
      title: 'Data stays at the university. [[Costs stay under control.]]',
      bullets: [
        'Reads from HEMIS only — never writes',
        'No personal data is sent to the AI',
        '8 of 10 test questions come from a verified bank — several times cheaper',
      ],
      ui: {
        server: 'University server', l1: 'Timetable · staff · students', l1b: 'HEMIS — read only',
        l2: 'Face templates', l2b: 'read only', l3: 'AI request', l3b: 'topic + textbook excerpt',
        cost: 'AI cost panel', bank: 'from bank', fresh: 'new',
      },
    },
    {
      kind: 'modules',
      section: 'Modules',
      title: 'One platform — [[the whole teaching process.]]',
      modules: [
        'Lecture generator', 'Slides · PPTX', 'Clinical cases', 'Tests and question bank',
        'Live test on the monitor', 'Department library', 'Clinical protocols', 'Rector monitoring',
        'Student results archive', 'Parent bot', 'Face sign-in', 'HEMIS integration',
      ],
    },
    {
      kind: 'rollout',
      section: 'Rollout',
      title: 'At your university — [[four stages.]]',
      steps: [
        { title: 'Demo', text: 'Real classes, real screens', value: '1 hour' },
        { title: 'Setup', text: 'Server, HEMIS, departments, library', value: '1 week' },
        { title: 'Pilot', text: '2–3 departments, teacher training', value: '2 weeks' },
        { title: 'Full launch', text: 'All departments and rector monitoring', value: 'together' },
      ],
    },
    {
      kind: 'closing',
      section: 'Summary',
      title: 'Preparation in minutes. [[Oversight with evidence.]]',
      lead: 'Proven at a real university on thousands of classes every day. Running at yours within a month.',
      bullets: ['HEMIS API access', 'Classroom screens', 'Department textbooks (PDF)'],
      ui: { need: 'You will need', site: 'imentor.uz', thanks: 'Thank you!' },
    },
  ],
};

/**
 * Animatsiyali interfeys bo'laklari uchun qo'shimcha yozuvlar (2026-11-13, "jonli" taqdimot) va har slayd
 * ostidagi izoh (`caption`) — tomoshabin nimani ko'rayotganini bilsin. Uch tilda kalitlar bir xil (test).
 */
type Extra = Partial<Record<SlideKind, Record<string, string>>>;

const UI_EXTRA: Record<PitchLang, Extra> = {
  uz: {
    title: { caption: 'Bir mavzu — to‘rt material, darsda test, rektorda natija', make: 'Yaratilmoqda' },
    stats: { caption: 'FJSTI, haqiqiy foydalanish' },
    teacher: { caption: 'Namuna: o‘qituvchi ekrani', field: 'Mavzu', generate: 'Yaratish', done: 'Tayyor' },
    quality: { caption: 'Namuna: ma’ruza matni va manbalari', book: 'Kafedra darsligi', protocol: 'Milliy klinik protokol' },
    live: { caption: 'Namuna: auditoriya monitori va talaba telefoni', readLabel: 'O‘qish', markLabel: 'Belgilash', demo: 'namoyish tezligida' },
    student: { caption: 'Namuna: kirish va ota-onaga xabar', typing: 'yozmoqda…', scan: 'Yuz tekshirilmoqda' },
    rector: { caption: 'Namuna: rektor paneli', toast: '2-para tugadi · hisobot yangilandi' },
    reasons: { caption: 'Namuna: bitta o‘qituvchining kuni', hint: 'Ekran bugun boshqa darslarda ham ishlamagan — ayb o‘qituvchida emas' },
    languages: { caption: 'Bitta mavzu — uch tilda', g1: 'O‘zbek guruhi', g2: 'Rus guruhi', g3: 'Ingliz guruhi' },
    security: { caption: 'Ma’lumot qayerga boradi', hemis: 'HEMIS', ai: 'AI xizmati', blocked: 'Ism, JSHSHIR, telefon — yuborilmaydi', readOnly: 'faqat o‘qish', serverSub: 'barcha ma’lumot shu yerda' },
    modules: { caption: 'Hammasi bitta hisobda, bitta tizimda' },
    rollout: { caption: 'Odatda bir oy' },
    closing: { caption: 'Taqdimotni telefonda oching', scan: 'Skanerlang' },
  },
  ru: {
    title: { caption: 'Одна тема — четыре материала, тест на занятии, результат у ректора', make: 'Создаётся' },
    stats: { caption: 'ФМИОЗ, реальное использование' },
    teacher: { caption: 'Пример: экран преподавателя', field: 'Тема', generate: 'Создать', done: 'Готово' },
    quality: { caption: 'Пример: текст лекции и его источники', book: 'Учебник кафедры', protocol: 'Национальный клинический протокол' },
    live: { caption: 'Пример: монитор аудитории и телефон студента', readLabel: 'Чтение', markLabel: 'Ответ', demo: 'в ускоренном показе' },
    student: { caption: 'Пример: вход и сообщение родителям', typing: 'печатает…', scan: 'Проверка лица' },
    rector: { caption: 'Пример: панель ректора', toast: '2 пара завершена · отчёт обновлён' },
    reasons: { caption: 'Пример: день одного преподавателя', hint: 'Экран сегодня не работал и на других занятиях — преподаватель не виноват' },
    languages: { caption: 'Одна тема — на трёх языках', g1: 'Узбекская группа', g2: 'Русская группа', g3: 'Английская группа' },
    security: { caption: 'Куда идут данные', hemis: 'HEMIS', ai: 'Сервис ИИ', blocked: 'ФИО, ПИНФЛ, телефон — не отправляются', readOnly: 'только чтение', serverSub: 'все данные хранятся здесь' },
    modules: { caption: 'Всё в одной учётной записи и одной системе' },
    rollout: { caption: 'Обычно один месяц' },
    closing: { caption: 'Откройте презентацию на телефоне', scan: 'Сканируйте' },
  },
  en: {
    title: { caption: 'One topic — four materials, a test in class, results for the rector', make: 'Generating' },
    stats: { caption: 'FMIPH, real use' },
    teacher: { caption: 'Example: the teacher’s screen', field: 'Topic', generate: 'Generate', done: 'Ready' },
    quality: { caption: 'Example: lecture text and its sources', book: 'Department textbook', protocol: 'National clinical protocol' },
    live: { caption: 'Example: classroom monitor and a student’s phone', readLabel: 'Reading', markLabel: 'Marking', demo: 'shown sped up' },
    student: { caption: 'Example: sign-in and a parent message', typing: 'typing…', scan: 'Checking face' },
    rector: { caption: 'Example: the rector’s dashboard', toast: 'Period 2 ended · report updated' },
    reasons: { caption: 'Example: one teacher’s day', hint: 'The screen was down in other classes today too — not the teacher’s fault' },
    languages: { caption: 'One topic — in three languages', g1: 'Uzbek group', g2: 'Russian group', g3: 'English group' },
    security: { caption: 'Where the data goes', hemis: 'HEMIS', ai: 'AI service', blocked: 'Names, national ID, phone — never sent', readOnly: 'read only', serverSub: 'all data stays here' },
    modules: { caption: 'All in one account, one system' },
    rollout: { caption: 'Usually one month' },
    closing: { caption: 'Open this presentation on your phone', scan: 'Scan' },
  },
};


/** Taqdimotchi izohlari (N tugmasi) — har slaydda nimani ta'kidlash kerak. Tartib slaydlar bilan bir xil. */
const NOTES: Record<PitchLang, string[]> = {
  uz: [
    "iMentor FJSTI'da ishlab chiqilgan va har kuni ishlatiladi. Bugun o'qituvchi, talaba va rektorga nima berishini ko'rsatamiz.",
    "Raqamlar haqiqiy: ekranli auditoriyalardagi darslarning 85% i iMentor bilan o'tmoqda — buyruq bilan emas, qulayligi uchun.",
    "Har bir yechim real shikoyatdan tug'ilgan. Chapdagi muammo har universitetda bor, o'ngdagisi — bizdagi javob.",
    "O'qituvchiga qo'shimcha ish yo'q: jadval HEMIS'dan keladi, material daqiqalarda tayyor, hisobot o'zi yig'iladi.",
    "Mavzu tanlanadi — ma'ruza, taqdimot, keys va test bir oynada chiqadi. O'qituvchi tahrirlaydi va saqlaydi.",
    "AI erkin yozmaydi: kafedra darsligi va milliy klinik protokolga tayanadi, manbani ko'rsatadi.",
    "Savol faqat monitorda, telefonda faqat variantlar — talaba savolni AI'ga yubora olmaydi. Hammasi vaqt bo'yicha, o'qituvchi aralashmaydi.",
    "Parol yo'q: yuz, JSHSHIR yoki talaba ID. Natija arxivga tushadi va ota-onaga Telegram orqali boradi.",
    "Rektor har raqam ortidagi ro'yxatni ko'radi: qaysi kafedra, o'qituvchi, dars. Dars tugashi bilan yangilanadi.",
    "'Ekran ishlamadi' kabi bahonalar tekshiriladi: xona boshqa darslarda ishlaganmi, o'qituvchi kirganmi. Kasallik varaqasi ayb emas.",
    "Bir marta yaratilgan material uch tilda ishlaydi — xalqaro guruhlar uchun alohida tayyorlash shart emas.",
    "Ma'lumot universitet serverida. HEMIS'dan faqat o'qiladi, AI'ga shaxsiy ma'lumot ketmaydi; savollar banki xarajatni kamaytiradi.",
    "Bular alohida dasturlar emas — bitta tizim, bitta hisob.",
    "Odatda bir oy: namoyish, o'rnatish, 2–3 kafedrada pilot, keyin to'liq ishga tushirish — biz bilan birga.",
    "Savollar? QR orqali taqdimotni telefonda ochish mumkin, PDF ham bor.",
  ],
  ru: [
    'iMentor разработан в ФМИОЗ и используется каждый день. Покажем, что он даёт преподавателю, студенту и ректору.',
    'Цифры реальные: 85% занятий в аудиториях с экраном идут с iMentor — не по приказу, а потому что удобно.',
    'Каждое решение родилось из реальной жалобы. Слева — проблема любого вуза, справа — наш ответ.',
    'Лишней работы нет: расписание приходит из HEMIS, материал готов за минуты, отчёт собирается сам.',
    'Выбрана тема — лекция, презентация, кейс и тест в одном окне. Преподаватель редактирует и сохраняет.',
    'ИИ не пишет свободно: опирается на учебник кафедры и национальный протокол, указывает источник.',
    'Вопрос только на мониторе, в телефоне только варианты — отправить вопрос в ИИ нельзя. Всё по времени, без вмешательства преподавателя.',
    'Без паролей: лицо, ПИНФЛ или ID студента. Результат попадает в архив и уходит родителям в Telegram.',
    'Ректор видит список за каждой цифрой: кафедра, преподаватель, занятие. Обновляется сразу после занятия.',
    'Отговорки вроде «экран не работал» проверяются: работала ли аудитория на других занятиях, входил ли преподаватель. Больничный — не вина.',
    'Материал, созданный один раз, работает на трёх языках — для иностранных групп ничего готовить отдельно не нужно.',
    'Данные на сервере университета. Из HEMIS только чтение, персональные данные в ИИ не уходят; банк вопросов снижает расходы.',
    'Это не отдельные программы — одна система и одна учётная запись.',
    'Обычно месяц: демонстрация, установка, пилот на 2–3 кафедрах, затем полный запуск — вместе с нами.',
    'Вопросы? Презентацию можно открыть на телефоне по QR-коду, есть и PDF.',
  ],
  en: [
    'iMentor was built at FMIPH and is used every day. We will show what it gives teachers, students and the rector.',
    'The numbers are real: 85% of classes in rooms with a screen run on iMentor — not by order, because it is convenient.',
    'Every solution came from a real complaint. On the left, a problem every university has; on the right, our answer.',
    'No extra work for teachers: the timetable comes from HEMIS, material is ready in minutes, the report builds itself.',
    'Pick a topic — lecture, slides, case and test appear in one place. The teacher edits and saves.',
    'The AI does not write freely: it relies on the department textbook and the national protocol and cites the source.',
    'The question is only on the monitor, the phone shows only options — nothing to paste into an AI. Everything runs on time, no teacher intervention.',
    'No passwords: face, national ID or student ID. Results go to the archive and to parents via Telegram.',
    'The rector sees the list behind every number: department, teacher, class. Updated as soon as the class ends.',
    'Excuses like "the screen was broken" are checked: did the room work in other classes, did the teacher sign in. A sick note is not a fault.',
    'Material created once works in three languages — nothing to prepare separately for international groups.',
    'Data stays on the university server. HEMIS is read only, no personal data goes to the AI; the question bank cuts costs.',
    'These are not separate programs — one system, one account.',
    'Usually a month: demo, setup, a pilot in 2–3 departments, then full launch — together with us.',
    'Questions? Open this deck on your phone via the QR code; a PDF is available too.',
  ],
};

function withExtra(text: DeckText, extra: Extra, notes: string[]): DeckText {
  return { ...text, slides: text.slides.map((s, i) => ({ ...s, notes: notes[i], ui: { ...(s.ui || {}), ...(extra[s.kind] || {}) } })) };
}

export const DECK_TEXT: Record<PitchLang, DeckText> = {
  uz: withExtra(uz, UI_EXTRA.uz, NOTES.uz),
  ru: withExtra(ru, UI_EXTRA.ru, NOTES.ru),
  en: withExtra(en, UI_EXTRA.en, NOTES.en),
};

/** Ekran-ustidagi yordamchi yozuvlar (umumiy ko'rinish, avto-namoyish). */
export const DECK_CHROME: Record<PitchLang, { overview: string; autoplay: string; stop: string; close: string; keys: string; tip: string; pdf: string; notes: string }> = {
  uz: { overview: 'Barcha slaydlar', autoplay: 'Avto-namoyish', stop: 'To‘xtatish', close: 'Yopish', keys: '← → · bo‘sh joy · F — to‘liq ekran · O — barcha slaydlar · P — avto', tip: 'yoki slayd ustiga bosing · F — to‘liq ekran · O — barcha slaydlar · N — izoh', pdf: 'PDF faylga saqlash (chop etish oynasi)', notes: 'Taqdimotchi uchun · N' },
  ru: { overview: 'Все слайды', autoplay: 'Автопоказ', stop: 'Стоп', close: 'Закрыть', keys: '← → · пробел · F — полный экран · O — все слайды · P — авто', tip: 'или щёлкните по слайду · F — полный экран · O — все слайды · N — заметки', pdf: 'Сохранить в PDF (окно печати)', notes: 'Для докладчика · N' },
  en: { overview: 'All slides', autoplay: 'Autoplay', stop: 'Stop', close: 'Close', keys: '← → · space · F — full screen · O — all slides · P — autoplay', tip: 'or click the slide · F — full screen · O — all slides · N — notes', pdf: 'Save as PDF (print dialog)', notes: 'Speaker notes · N' },
};
