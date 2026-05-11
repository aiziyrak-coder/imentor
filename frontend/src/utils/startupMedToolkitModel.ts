/**
 * Tibbiyot startap yo‘riqnomasi — checklist kalitlari (workspace_profile.med_toolkit_checks).
 * Reactdan mustaqil — AI matn va statistik uchun.
 */

export type MedToolkitChecks = Record<string, boolean[]>;

export type MedToolkitItemData = {
  id: string;
  title: string;
  lead: string;
  actions: readonly string[];
};

export const MED_TOOLKIT_ITEMS: readonly MedToolkitItemData[] = [
  {
    id: 'problem-payer',
    title: 'Muammo, to‘lovchi va qaror qabul qiluvchini ajrating',
    lead: 'Tibbiyotda “foydalanuvchi” va “to‘lovchi” ko‘pincha boshqacha; sotish tsikli uzoq.',
    actions: [
      'Kimning hayoti yaxshilanadi (bemor, shifokor, registratura)?',
      'Kim hisobdan to‘laydi (davlat, sug‘urta, xususiy klinika, bemormi)?',
      'Kim xarid qarorini qabul qiladi (bosh shifokor, IT, moliya)?',
      'Har bir segment uchun 3 ta tasdiqlovchi dalil (suhbat, yozma, raqam) rejalashtiring.',
    ],
  },
  {
    id: 'regulatory-map',
    title: 'Normativ xarita: qaysi organ va qaysi tartib?',
    lead: 'Mahsulot turi (dori, tibbiy buyum, dastur, xizmat) bo‘yicha yo‘l har xil.',
    actions: [
      'Mahsulotingiz “tibbiy faoliyat”, “tibbiy buyum”, “dori” yoki “axborot tizimi” qatoridan qaysiga yaqin ekanini aniqlang.',
      'Rasmiy portal va qarorlar bazasidan so‘nggi tegishli normativ hujjatlarni qidiring (siz ularni “o‘qib chiqish” ro‘yxatiga yozing).',
      'MVP dan oldin minimal ruxsat / ro‘yxatdan o‘tish / sinov shartlarini huquqshunos bilan bir qatorda tekshiring.',
    ],
  },
  {
    id: 'pilot-design',
    title: 'Pilotni klinika haqiqatiga mos dizayn qiling',
    lead: 'Bitta shifoxona ichidagi ish oqimi — eng arzon “haqiqiy” sinov.',
    actions: [
      'Pilot joy: statsionar, poliklinika, diagnostika, TA markazi — bittasini tanlang.',
      'KPI: vaqt tejalishi, xato kamayishi, navbat, qoniqish — 2–4 ta aniq metrika.',
      'Integratsiya: HIS/LIS, brauzer, mobil — qayerdan boshlash mumkin?',
      'Pilot tugagach nima bo‘ladi (shartnoma, tarif, qo‘llab-quvvatlash)?',
    ],
  },
  {
    id: 'device-software-path',
    title: 'Tibbiy buyum vs dastur — klassifikatsiya va yo‘l xaritasi',
    lead: '“Dastur” deb ko‘rinsa ham ba’zan tibbiy buyum rejimiga tushadi; erta aniqlang.',
    actions: [
      'Xavf darajasi (bemor uchun potentsial zarar) bo‘yicha sinfini taxminlang.',
      'Texnik hujjatlar ro‘yxati: IFU, xavfsizlik, tekshiruv, klinik baholash kerak-mi?',
      'Ishlab chiqarish / import / markalash bo‘yicha keyingi 90 kunlik vazifalar.',
    ],
  },
  {
    id: 'data-privacy',
    title: 'Shaxsiy ma’lumot va tibbiy maxfiylik — dizayn bilan',
    lead: 'O‘zbekistonda ham talablar kuchaymoqda; “keyin qilamiz” xavfli.',
    actions: [
      'Qaysi ma’lumotlar yigiladi, qayerda saqlanadi, qancha muddat, kim ko‘radi — jadval.',
      'Pseudonimlashtirish, kirish huquqlari, audit log — MVP da nimani qilasiz?',
      'Bemor roziligini qanday oson va tushunarli qilasiz (til, format)?',
    ],
  },
  {
    id: 'ethics-clinical',
    title: 'Etika va klinik sinov — erta rejalang',
    lead: 'Tadqiqot yoki klinik baholash bo‘lsa, etika komissiyasi vaqt oladi.',
    actions: [
      'Sinov protokoli: maqsad, namuna, xavf, foyda, alternativ yechimlar.',
      'Informed consent va ma’lumot xavfsizligi modullari.',
      'Statistika: kim hisoblaydi, qanday dastur, qanday hisobot?',
    ],
  },
  {
    id: 'grants-uz',
    title: 'Grant va dasturlar — mahalliy “yoqilg‘i”',
    lead: 'Innova startaplar ko‘pincha grant + pilot bilan boshlanadi.',
    actions: [
      'Loyiha turi bo‘yicha mos grant yo‘nalishlarini ro‘yxatlang (texnik, ijtimoiy, ilmiy).',
      'Dalillar paketi: metodika, byudjet, jamoa, kutilayotgan natija, kengaytirish.',
      'Har bir dastur uchun alohida 1 sahifalik “moslik” xulosasi yozing.',
    ],
  },
  {
    id: 'bilingual-pitch',
    title: 'Pitch: o‘zbek auditoriya + xalqaro 1 sahifa',
    lead: 'Maslahatchi, investor yoki hamkor xorijda bo‘lishi mumkin.',
    actions: [
      '30 soniya hook (muammo + kim uchun + nima o‘zgardi).',
      '1 sahifalik inglizcha summary (GPT bilan tahrir, lekin faktlarni tekshiring).',
      '“Nega hozir?” va “nima uchun biz?” — alohida 2 ta jumlada.',
    ],
  },
  {
    id: 'competitive-landscape',
    title: 'Raqobat xaritasi: mahalliy va global analoglar',
    lead: '“Bizda yo‘q” emas, “bizda shunday, lekin …” degan pozitsiya kerak.',
    actions: [
      '3 ta mahalliy yoki mintaqaviy analog + narx / kanal / zaifliklari.',
      '3 ta global analog + nimani moslashtirasiz (localization).',
      'Sizning “10x” da’voringiz qaysi 1–2 metrikada o‘lchanadi?',
    ],
  },
  {
    id: 'ip-strategy',
    title: 'Intellectual property: erta hujjatlang',
    lead: 'Kod va tajriba “ochiq” bo‘lib ketmasligi uchun tartib.',
    actions: [
      'Nondisclosure (NDA) shablonlari va hamkorlar bilan ketma-ketlik.',
      'Inventivlik va know-how: nima maxfiy, nima ochiq demo?',
      'Patent / foydali model / dastur huquqi — qaysi yo‘l sizga tegishli?',
    ],
  },
  {
    id: 'team-triangle',
    title: '“Tibbiyot + texnika + huquq” uchburchagi',
    lead: 'Faqat dasturchi yoki faqat shifokor yetarli emas.',
    actions: [
      'Klinik maslahatchi (lavozim va haftalik vaqt).',
      'Texnik rahbar (xavfsizlik, integratsiya, sifat).',
      'Huquq/regulyator maslahatchi (hatto soatlik konsultatsiya).',
    ],
  },
  {
    id: 'monetization-b2g',
    title: 'Monetizatsiya: B2G, B2B, B2B2C va sug‘urta',
    lead: 'Tibbiyotda pullash ko‘pincha shartnoma va tender orqali kechikadi.',
    actions: [
      'Birinchi to‘lovchi kim bo‘lishi realistik (klinika, TA, korporatsiya)?',
      'Abonent, litsenziya, transaktsiya, xizmat paketi — qaysi model?',
      '12 oy uchun 3 ta daromad ssenariysi (optim / bazaviy / stress).',
    ],
  },
  {
    id: 'telemed-uz',
    title: 'Telemeditsina va masofa bilan xizmat',
    lead: 'Geografiya, sertifikatlash va hisobot talablari — pilotdan oldin.',
    actions: [
      'Qaysi viloyat / segmentdan boshlaysiz?',
      'Video / chat / fayl almashinuv — minimal xavfsizlik talablari.',
      'Shifokor yuklamasi va navbat boshqaruvi bilan qanday uyg‘unasiz?',
    ],
  },
  {
    id: 'ai-med-evidence',
    title: 'AI tibbiyotda: ishonch va tasdiqlanadigan dalil',
    lead: '“AI aytgan” yetmaydi — klinik va operatsion isbot kerak.',
    actions: [
      'Model baholash: sensivlik, spesifislik, cohort, cheklovlar.',
      'Human-in-the-loop: qayerda shifokor tasdiqlashi shart?',
      'Xatolik holatida javobgarlik va foydalanuvchi xabari.',
    ],
  },
  {
    id: 'lab-integration',
    title: 'Laboratoriya va diagnostika integratsiyasi',
    lead: 'LIS/HIS ulanishi — startapning “qiyin lekin mo‘l” qismi.',
    actions: [
      'Qaysi format (HL7, CSV, API) realistik MVP?',
      'Namuna identifikatsiyasi va xato yo‘q qilish mexanizmi.',
      'Hamkor laboratoriya bilan pilot shartnomasi tuzilish tartibi.',
    ],
  },
  {
    id: 'quality-systems',
    title: 'Sifat tizimlari: ISO va ichki SOP',
    lead: 'Klinik hamkorlar sizdan tartib so‘rashadi.',
    actions: [
      'Hujjatlashtirilgan jarayonlar (SOP) ro‘yxati: qabul, xato, incident.',
      'Versiya boshqaruvi va relizlar uchun minimal siyosat.',
      'Mijoz qo‘llab-quvvatlash va SLA (hatto oddiy jadval).',
    ],
  },
  {
    id: 'public-procurement',
    title: 'Davlat xaridlari va tenderlar',
    lead: 'Ko‘plab tibbiyot innovatsiyalari davlat kanali orqali masshtablanadi.',
    actions: [
      'Tenderda “texnik spetsifikatsiya” va ishonch hujjatlari nimalardan iborat?',
      'Pilot natijalari va ijtimoiy ta’sir hisoboti.',
      'Hamkor integratorlar bilan birga chiqish strategiyasi.',
    ],
  },
  {
    id: 'regional-expansion',
    title: 'Mintaqaviy kengaytirish (KG, TJ, QA) — tartib bilan',
    lead: 'Bir xil mahsulot — har bir mamlakatda alohida talab.',
    actions: [
      'Birinchi chegaradan tashqari bozor: kim, nima uchun?',
      'Mahalliy hamkor (distributor, klinika tarmog‘i) roli.',
      'Til, to‘lov, logistika — minimal talablar ro‘yxati.',
    ],
  },
  {
    id: 'university-incubation',
    title: 'Universitet, kafedra va inkubator — “yoqilg‘i” va kadrlar',
    lead: 'FJSTI kabi joyda laboratoriya, talabalar, ilmiy maslahatchi yaqin.',
    actions: [
      'Qaysi kafedra yoki laboratoriya sizning texnologiyangizga eng yaqin?',
      'Qo‘shma loyiha / diplom ishi / staj — kadrlar kanali.',
      'Ilmiy ko‘rsatkichlar (maqola, konferensiya) grant va ishonch uchun.',
    ],
  },
  {
    id: 'stress-test-30',
    title: '30 kunlik stress-test: xavf + KPI + stop-shartlar',
    lead: 'Inqilob — tez iteratsiya; lekin “qachon to‘xtaymiz” ham muhim.',
    actions: [
      'Top-5 xavf: ehtimollik va ta’sir, har biri uchun yumshatish.',
      'Har hafta 1 ta o‘lchov: foydalanuvchi, xato, vaqt, moliya.',
      'Stop-shart: qaysi dalil bo‘lmasa pivot qilasiz?',
    ],
  },
] as const;

const TOTAL_ACTIONS = MED_TOOLKIT_ITEMS.reduce((n, it) => n + it.actions.length, 0);

export function parseMedToolkitChecksFromProfile(raw: unknown): MedToolkitChecks {
  if (!raw || typeof raw !== 'object') return {};
  const v = (raw as Record<string, unknown>).med_toolkit_checks;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: MedToolkitChecks = {};
  for (const [k, val] of Object.entries(v)) {
    if (Array.isArray(val)) {
      out[k] = val.map((x) => Boolean(x));
    }
  }
  return out;
}

export function normalizeItemChecks(
  itemId: string,
  actionCount: number,
  checks: MedToolkitChecks
): boolean[] {
  const raw = checks[itemId];
  const base = Array.from({ length: actionCount }, () => false);
  if (!Array.isArray(raw)) return base;
  for (let i = 0; i < Math.min(raw.length, actionCount); i++) {
    base[i] = Boolean(raw[i]);
  }
  return base;
}

export function computeMedToolkitProgress(checks: MedToolkitChecks | undefined): {
  done: number;
  total: number;
  sectionsComplete: number;
  percent: number;
} {
  const c = checks ?? {};
  let done = 0;
  let sectionsComplete = 0;
  for (const item of MED_TOOLKIT_ITEMS) {
    const row = normalizeItemChecks(item.id, item.actions.length, c);
    const d = row.filter(Boolean).length;
    done += d;
    if (d === item.actions.length && item.actions.length > 0) sectionsComplete++;
  }
  const percent = TOTAL_ACTIONS <= 0 ? 0 : Math.round((done / TOTAL_ACTIONS) * 100);
  return { done, total: TOTAL_ACTIONS, sectionsComplete, percent };
}

/** AI tahlil va maslahatchiga yuboriladigan qo‘shimcha matn */
export function buildMedToolkitAiAppendix(checks: MedToolkitChecks | undefined): string {
  if (!checks || Object.keys(checks).length === 0) return '';
  const lines: string[] = [];
  for (const item of MED_TOOLKIT_ITEMS) {
    const row = normalizeItemChecks(item.id, item.actions.length, checks);
    const doneTexts = item.actions.filter((_, i) => row[i]);
    if (doneTexts.length === 0) continue;
    lines.push(`${item.title} (bajarilgan ${doneTexts.length}/${item.actions.length}):`);
    doneTexts.forEach((t) => lines.push(`- ${t}`));
  }
  if (lines.length === 0) return '';
  return '\nTibbiyot startap yo‘riqnomasi — foydalanuvchi tomonidan belgilangan checklist:\n' + lines.join('\n');
}

export function buildMedToolkitPlainTextWithChecks(checks: MedToolkitChecks | undefined): string {
  const c = checks ?? {};
  return MED_TOOLKIT_ITEMS.map((item, idx) => {
    const row = normalizeItemChecks(item.id, item.actions.length, c);
    const body = item.actions
      .map((a, i) => `${row[i] ? '[x]' : '[ ]'} ${a}`)
      .join('\n');
    return `${idx + 1}. ${item.title}\n${item.lead}\n${body}`;
  }).join('\n\n');
}

export function buildSectionPlainText(itemId: string, checks: MedToolkitChecks | undefined): string {
  const item = MED_TOOLKIT_ITEMS.find((x) => x.id === itemId);
  if (!item) return '';
  const row = normalizeItemChecks(item.id, item.actions.length, checks ?? {});
  const body = item.actions.map((a, i) => `${row[i] ? '[x]' : '[ ]'} ${a}`).join('\n');
  return `${item.title}\n${item.lead}\n\n${body}`;
}
