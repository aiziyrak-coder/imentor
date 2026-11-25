import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  FileUp,
  HeartPulse,
  KeyRound,
  Loader2,
  ScanFace,
  Settings,
  ShieldCheck,
  Pencil,
  Trash2,
  UserRound,
} from 'lucide-react';
import UserProfile from '../UserProfile';
import LessonProgress from '../LessonProgress';
import { AppLanguageContext, GlobalTopicContext } from '../../App';
import AccountSecurityCard from './AccountSecurityCard';
import StaffPageLayout from '../staff/StaffPageLayout';
import StaffTeachingSubjectsPicker from '../staff/StaffTeachingSubjectsPicker';
import OwnSubjectUpload, { OWN_SUBJECT_TEMPLATE_URL } from '../staff/OwnSubjectUpload';
import {
  deleteLibraryItem,
  errorText,
  fetchMyAbsences,
  fetchSubstituteCandidates,
  openAbsenceDocument,
  setAbsenceSubstitute,
  submitAbsence,
  withdrawAbsence,
  type Absence,
  type AbsenceKind,
  type AbsenceSubstitute,
  fetchDepartments,
  fetchLibrary,
  reindexLibraryItem,
  fetchMyProfile,
  fetchTestTiming,
  saveMyProfile,
  saveTestTiming,
  type TestTiming,
  updateLibraryItem,
  uploadLibraryItem,
  type Department,
  type LibraryItem,
  type MyProfile,
} from '../../utils/staffSelfApi';
import { getCurrentLocalUser, updateCurrentLocalUser } from '../../utils/localStaffAuth';
import { useSettingsText, type SettingsText } from './teacherSettingsText';
import { useLocalizedNames } from '../../utils/nameI18n';
import { useUiText } from '../../i18n/useUiText';

/**
 * O'qituvchi sozlamalari — hamma narsani o'zi qiladi (2026-09-24).
 *
 * Har bo'lim alohida ichki sahifa, har birida "Qanday qilinadi" tushuntirishi va
 * kerak joyda namuna fayl bor. Hammasi faqat O'Z ma'lumotiga yoki O'Z kafedrasiga
 * ta'sir qiladi — hamkasblarning ishi bilan to'qnashmaydi (backend `staff_self.py`).
 */

type Tab = 'profile' | 'subjects' | 'library' | 'absence' | 'access';

const TABS: Array<{ id: Tab; label: keyof SettingsText; hint: keyof SettingsText; icon: React.ElementType }> = [
  { id: 'profile', label: 'tabProfile', hint: 'tabProfileHint', icon: UserRound },
  { id: 'subjects', label: 'tabSubjects', hint: 'tabSubjectsHint', icon: BookOpen },
  { id: 'library', label: 'tabLibrary', hint: 'tabLibraryHint', icon: BookMarked },
  { id: 'absence', label: 'tabAbsence', hint: 'tabAbsenceHint', icon: HeartPulse },
  { id: 'access', label: 'tabAccess', hint: 'tabAccessHint', icon: ShieldCheck },
];

const TAB_KEY = 'imentor.settings.tab';
const FACE_REGISTRATION_URL = 'https://cam.fermi.uz/royxatdan-otish';

const CARD = 'rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.07] sm:p-6';
const INPUT =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15';
const BTN_PRIMARY =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50';
const BTN_SECONDARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[13.5px] font-semibold text-slate-700 ring-1 ring-slate-900/10 hover:bg-slate-50';

function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    return v && TABS.some((t) => t.id === v) ? v : 'profile';
  } catch {
    return 'profile';
  }
}

/** Bo'lim yonidagi qisqa yo'riqnoma (keng ekranda o'ngda, telefonda pastda). */
function HowTo({ steps, note }: { steps: string[]; note?: string }) {
  const s = useSettingsText();
  return (
    <aside className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-900/[0.06] xl:sticky xl:top-4">
      <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">{s.howTo}</p>
      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-slate-600">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700 ring-1 ring-slate-900/10">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-3 border-t border-slate-200 pt-3 text-[12px] leading-snug text-slate-500">{note}</p>}
    </aside>
  );
}

/** Bo'lim: sarlavha + mazmun (chapda) va yo'riqnoma (o'ngda). */
function Panel({
  title,
  intro,
  howto,
  children,
}: {
  title: string;
  intro: string;
  howto: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-1 text-[13px] text-slate-500">{intro}</p>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">{children}</div>
        {howto}
      </div>
    </div>
  );
}

function Message({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: React.ReactNode }) {
  const tone =
    kind === 'ok'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : kind === 'error'
        ? 'bg-rose-50 text-rose-700 ring-rose-200'
        : 'bg-amber-50 text-amber-900 ring-amber-200';
  return <div className={`rounded-xl px-4 py-3 text-[13.5px] leading-snug ring-1 ${tone}`}>{children}</div>;
}

// ============================================================ Profil

function WorkplaceCard() {
  const s = useSettingsText();
  const { language } = useUiText();
  // Kafedra nomlari interfeys tilida; tarjima kelguncha "…" turadi.
  const names = useLocalizedNames(language, [], true);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({ first_name: '', last_name: '', job_title: '', department_id: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [p, d] = await Promise.all([fetchMyProfile(), fetchDepartments()]);
        setProfile(p);
        setDepartments(d);
        setForm({
          first_name: p.first_name,
          last_name: p.last_name,
          job_title: p.job_title,
          department_id: p.department_id || 0,
        });
      } catch (err) {
        setMsg({ kind: 'error', text: errorText(err, s.profileLoadError) });
      }
    })();
  }, []);

  const deptChanged = Boolean(profile && form.department_id && form.department_id !== (profile.department_id || 0));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setMsg({ kind: 'error', text: s.nameRequired });
      return;
    }
    if (
      deptChanged &&
      !window.confirm(s.deptConfirm)
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const p = await saveMyProfile({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        job_title: form.job_title.trim(),
        department_id: form.department_id || null,
      });
      setProfile(p);
      // Brauzerdagi seans ham yangilansin (sarlavhadagi ism).
      if (getCurrentLocalUser()) {
        updateCurrentLocalUser({
          firstName: p.first_name,
          lastName: p.last_name,
          displayName: `${p.first_name} ${p.last_name}`.trim(),
          department: p.department,
        });
      }
      if (deptChanged) window.dispatchEvent(new CustomEvent('imentor:teaching-subjects-changed'));
      setMsg({ kind: 'ok', text: deptChanged ? s.savedDeptChanged : s.saved });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.saveError) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD}>
      <h3 className="text-[15px] font-semibold text-slate-900">{s.workplaceTitle}</h3>
      {!profile && !msg ? (
        <div className="py-8 text-center"><Loader2 className="mx-auto animate-spin text-sky-600" /></div>
      ) : (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-slate-500">{s.lastName}</span>
            <input className={INPUT} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-slate-500">{s.firstName}</span>
            <input className={INPUT} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-slate-500">{s.jobTitle}</span>
            <input
              className={INPUT}
              value={form.job_title}
              placeholder={s.jobTitlePlaceholder}
              onChange={(e) => setForm({ ...form, job_title: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-slate-500">{s.department}</span>
            <select
              className={INPUT}
              value={form.department_id || ''}
              onChange={(e) => setForm({ ...form, department_id: Number(e.target.value) || 0 })}
            >
              <option value="">{s.choose}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{names.departmentName(d.name) ?? '…'}</option>
              ))}
            </select>
          </label>
          {deptChanged && (
            <div className="sm:col-span-2">
              <Message kind="info">
                {s.deptChangeInfo}
              </Message>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />} {s.save}
            </button>
            {profile && (
              <span className="text-[12.5px] text-slate-400">Login: <b className="text-slate-600">{profile.login}</b> — {s.loginFixed}</span>
            )}
          </div>
          {msg && <div className="sm:col-span-2"><Message kind={msg.kind}>{msg.text}</Message></div>}
        </form>
      )}
    </section>
  );
}

// Jonli test vaqtlari (2026-11-25): o'qituvchi o'zi sozlaydi, har biri ko'pi bilan 2 daqiqa.
const TIMING_TEXT = {
  uz: {
    title: 'Jonli test vaqtlari',
    hint: 'Har savol avval monitorda o‘qish uchun ko‘rsatiladi, keyin talabalar telefonda javob belgilaydi. Ikkala vaqtni o‘zingiz tanlang (har biri 10 soniyadan 2 daqiqagacha). Hamma javob belgilasa, keyingi savol darhol chiqadi.',
    read: 'Savolni o‘qish vaqti',
    answer: 'Javob belgilash vaqti',
    perQuestion: 'Bir savolga jami',
    reset: 'Umumiy qiymatga qaytarish',
    saved: 'Saqlandi. Keyingi jonli testlar shu vaqtlar bilan o‘tadi.',
    error: 'Saqlab bo‘lmadi.',
    sec: 'soniya',
    min: 'daq',
  },
  ru: {
    title: 'Время живого теста',
    hint: 'Каждый вопрос сначала показывается на мониторе для чтения, затем студенты отмечают ответ на телефоне. Выберите оба времени сами (каждое от 10 секунд до 2 минут). Если все ответили, следующий вопрос появляется сразу.',
    read: 'Время на чтение вопроса',
    answer: 'Время на ответ',
    perQuestion: 'Всего на вопрос',
    reset: 'Вернуть общее значение',
    saved: 'Сохранено. Следующие живые тесты пройдут с этим временем.',
    error: 'Не удалось сохранить.',
    sec: 'сек',
    min: 'мин',
  },
  en: {
    title: 'Live test timing',
    hint: 'Each question is first shown on the monitor for reading, then students mark an answer on their phones. Choose both times yourself (each from 10 seconds to 2 minutes). If everyone answers, the next question appears at once.',
    read: 'Time to read the question',
    answer: 'Time to answer',
    perQuestion: 'Total per question',
    reset: 'Back to the default',
    saved: 'Saved. Your next live tests will use these times.',
    error: 'Could not save.',
    sec: 'sec',
    min: 'min',
  },
};

function TestTimingCard() {
  const { language } = useUiText();
  const t = TIMING_TEXT[(language as keyof typeof TIMING_TEXT)] || TIMING_TEXT.uz;
  const s = useSettingsText();
  const [data, setData] = useState<TestTiming | null>(null);
  const [read, setRead] = useState(45);
  const [answer, setAnswer] = useState(45);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchTestTiming()
      .then((d) => {
        setData(d);
        setRead(d.read_seconds);
        setAnswer(d.answer_seconds);
      })
      .catch((err) => setMsg({ kind: 'error', text: errorText(err, t.error) }));
  }, []);

  const fmt = (v: number) => (v >= 60 ? `${Math.floor(v / 60)} ${t.min}${v % 60 ? ` ${v % 60} ${t.sec}` : ''}` : `${v} ${t.sec}`);

  const save = async (next: { read_seconds: number | null; answer_seconds: number | null }) => {
    setBusy(true);
    setMsg(null);
    try {
      const d = await saveTestTiming(next);
      setData(d);
      setRead(d.read_seconds);
      setAnswer(d.answer_seconds);
      setMsg({ kind: 'ok', text: t.saved });
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, t.error) });
    } finally {
      setBusy(false);
    }
  };

  const lo = data?.min ?? 10;
  const hi = data?.max ?? 120;
  const slider = (label: string, value: number, set: (v: number) => void) => (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[12.5px] font-semibold text-slate-600">
        {label}
        <b className="text-[15px] tabular-nums text-slate-900">{fmt(value)}</b>
      </span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={5}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-sky-600"
      />
      <span className="flex justify-between text-[11.5px] text-slate-400">
        <span>{fmt(lo)}</span>
        <span>{fmt(hi)}</span>
      </span>
    </label>
  );

  return (
    <section className={CARD}>
      <h3 className="text-[15px] font-semibold text-slate-900">{t.title}</h3>
      <p className="mt-1 text-[13px] leading-snug text-slate-500">{t.hint}</p>
      {!data && !msg ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto animate-spin text-sky-600" /></div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-5 sm:grid-cols-2">
            {slider(t.read, read, setRead)}
            {slider(t.answer, answer, setAnswer)}
          </div>
          <p className="text-[13px] text-slate-500">
            {t.perQuestion}: <b className="text-slate-800">{fmt(read + answer)}</b>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy}
              onClick={() => void save({ read_seconds: read, answer_seconds: answer })}
            >
              {busy && <Loader2 size={16} className="animate-spin" />} {s.save}
            </button>
            {data?.custom && (
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => void save({ read_seconds: null, answer_seconds: null })}>
                {t.reset} ({fmt(data.default_read)} + {fmt(data.default_answer)})
              </button>
            )}
          </div>
          {msg && <Message kind={msg.kind}>{msg.text}</Message>}
        </div>
      )}
    </section>
  );
}

function ProfilePanel() {
  const s = useSettingsText();
  const topic = React.useContext(GlobalTopicContext);
  const { language } = React.useContext(AppLanguageContext);
  return (
    <Panel
      title={s.tabProfile}
      intro={s.profileIntro}
      howto={<HowTo steps={[s.profileStep1, s.profileStep2, s.profileStep3]} note={s.profileNote} />}
    >
      {/* Bugungi dars rejasi (2026-11-23): dars sahifalarida xalaqit bermasin — faqat shu yerda. */}
      {topic && <LessonProgress topic={topic} language={language} mode="card" />}
      <WorkplaceCard />
      <TestTimingCard />
      <UserProfile embedded />
    </Panel>
  );
}

// ============================================================ Fanlarim

function SubjectsPanel() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const s = useSettingsText();
  return (
    <Panel
      title={s.tabSubjects}
      intro={s.subjectsIntro}
      howto={<HowTo steps={[s.subjectsStep1, s.subjectsStep2, s.subjectsStep3]} note={s.subjectsNote} />}
    >

      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-bold text-slate-900">{s.ownUploadTitle}</h3>
            <p className="mt-1 text-[13px] text-slate-500">{s.ownUploadHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={OWN_SUBJECT_TEMPLATE_URL} download="namuna-fan-mavzulari.xlsx" className={BTN_SECONDARY}>
              <Download size={16} /> {s.templateFile}
            </a>
            <button type="button" className={BTN_PRIMARY} onClick={() => setUploadOpen((v) => !v)}>
              <FileUp size={16} /> {s.uploadFromFile}
            </button>
          </div>
        </div>
        {uploadOpen && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <OwnSubjectUpload
              onCreated={() => {
                setUploadOpen(false);
                setDone(s.subjectAdded);
                window.dispatchEvent(new CustomEvent('imentor:teaching-subjects-changed'));
              }}
            />
          </div>
        )}
        {done && <div className="mt-4"><Message kind="ok">{done}</Message></div>}
      </section>

      <section className={CARD}>
        <h3 className="mb-3 text-[17px] font-bold text-slate-900">{s.mySubjects}</h3>
        <StaffTeachingSubjectsPicker variant="profile" showHeader={false} />
      </section>
    </Panel>
  );
}

// ============================================================ Kafedra kutubxonasi

const STATUS_KEY: Record<LibraryItem['status'], keyof SettingsText> = {
  ready: 'statusReady',
  processing: 'statusProcessing',
  failed: 'statusFailed',
};

// ============================================================ Kasallik / ta'til (2026-10-28)

const ABSENCE_KINDS: Array<{ id: AbsenceKind; label: keyof SettingsText }> = [
  { id: 'kasallik', label: 'absenceKindSick' },
  { id: 'tatil', label: 'absenceKindVacation' },
  { id: 'dekret', label: 'absenceKindMaternity' },
  { id: 'malaka', label: 'absenceKindTraining' },
  { id: 'safar', label: 'absenceKindTrip' },
  { id: 'boshqa', label: 'absenceKindOther' },
];

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** O'rinbosar tanlash (2026-11-19): ism/familiya bo'yicha qidiruv, avval o'z kafedrasidagilar. */
function SubstitutePicker({ value, onChange }: { value: AbsenceSubstitute | null; onChange: (v: AbsenceSubstitute | null) => void }) {
  const s = useSettingsText();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AbsenceSubstitute[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetchSubstituteCandidates(q.trim())
        .then((list) => alive && setItems(list))
        .catch(() => alive && setItems([]));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [q, open]);
  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-[14px] font-semibold text-slate-800">{value.name}</span>
        {value.department && <span className="text-[12.5px] text-slate-500">{value.department}</span>}
        <button type="button" className="ml-auto text-[13px] font-medium text-rose-600 hover:underline" onClick={() => onChange(null)}>
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        className={INPUT}
        value={q}
        placeholder={s.absenceSubSearch}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && items && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.length === 0 && <li className="px-3 py-2 text-[13px] text-slate-500">{s.absenceSubNotFound}</li>}
          {items.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  onChange(it);
                  setOpen(false);
                  setQ('');
                }}
              >
                <span className="block text-[13.5px] font-medium text-slate-800">{it.name}</span>
                {it.department && <span className="block text-[12px] text-slate-500">{it.department}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AbsencePanel() {
  const s = useSettingsText();
  const [items, setItems] = useState<Absence[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<AbsenceKind>('kasallik');
  const [startDate, setStartDate] = useState(localToday);
  const [endDate, setEndDate] = useState(localToday);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [substitute, setSubstitute] = useState<AbsenceSubstitute | null>(null);
  const [editingSub, setEditingSub] = useState<number | null>(null);
  const [subDraft, setSubDraft] = useState<AbsenceSubstitute | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setItems((await fetchMyAbsences()).items);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, s.absenceLoadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      await submitAbsence({ kind, startDate, endDate, note: note.trim(), file, substituteKey: substitute?.key });
      setFile(null);
      setNote('');
      setSubstitute(null);
      if (inputRef.current) inputRef.current.value = '';
      setMsg({ kind: 'ok', text: s.absenceSent });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.absenceError) });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (item: Absence) => {
    if (!window.confirm(s.absenceWithdrawConfirm)) return;
    try {
      await withdrawAbsence(item.id);
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.absenceError) });
    }
  };

  const saveSub = async (item: Absence) => {
    try {
      await setAbsenceSubstitute(item.id, subDraft?.key || '');
      setEditingSub(null);
      setMsg({ kind: 'ok', text: s.absenceSubSaved });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.absenceError) });
    }
  };

  const showDoc = async (item: Absence) => {
    try {
      await openAbsenceDocument(item.id, 'me');
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.absenceError) });
    }
  };

  const statusChip = (status: Absence['status']) =>
    status === 'approved'
      ? ['bg-emerald-50 text-emerald-700 ring-emerald-200', s.absenceApproved]
      : status === 'rejected'
        ? ['bg-rose-50 text-rose-700 ring-rose-200', s.absenceRejected]
        : ['bg-amber-50 text-amber-800 ring-amber-200', s.absencePending];

  return (
    <Panel
      title={s.absenceTitle}
      intro={s.absenceIntro}
      howto={<HowTo steps={[s.absenceStep1, s.absenceStep2, s.absenceStep3, s.absenceStep4]} note={s.absenceHowNote} />}
    >
      <form onSubmit={(e) => void submit(e)} className={`${CARD} space-y-4`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{s.absenceKind}</span>
            <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as AbsenceKind)}>
              {ABSENCE_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {s[k.label]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{s.absenceFrom}</span>
            <input
              type="date"
              className={INPUT}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{s.absenceTo}</span>
            <input
              type="date"
              className={INPUT}
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </label>
        </div>
        <div>
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{s.absenceSub}</span>
          <SubstitutePicker value={substitute} onChange={setSubstitute} />
          <p className="mt-1.5 text-[12px] text-slate-400">{s.absenceSubHint}</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{s.absenceNote}</span>
          <input
            className={INPUT}
            value={note}
            maxLength={500}
            placeholder={s.absenceNotePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div>
          <span className="mb-1.5 block text-[12.5px] font-semibold text-slate-600">{s.absenceDoc}</span>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SECONDARY} onClick={() => inputRef.current?.click()}>
              <FileUp size={16} />
              {s.absenceChoose}
            </button>
            <span className="min-w-0 truncate text-[13px] text-slate-500">{file?.name || ''}</span>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-slate-400">{s.absenceDocHint}</p>
        </div>
        {msg && <Message kind={msg.kind}>{msg.text}</Message>}
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !file || !startDate || !endDate}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          {s.absenceSubmit}
        </button>
      </form>

      <div className={CARD}>
        <h3 className="mb-3 text-[15px] font-semibold text-slate-900">{s.absenceListTitle}</h3>
        {loadError && <Message kind="error">{loadError}</Message>}
        {items && items.length === 0 && <p className="text-[13px] text-slate-500">{s.absenceEmpty}</p>}
        <ul className="divide-y divide-slate-100">
          {(items || []).map((item) => {
            const [tone, label] = statusChip(item.status);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                <span className="text-[14px] font-semibold text-slate-800">{item.kind_label}</span>
                <span className="text-[13px] text-slate-500">
                  {shortDate(item.start_date)} – {shortDate(item.end_date)} · {item.days} {s.absenceDays}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${tone}`}>{label}</span>
                <span className="ml-auto flex items-center gap-2">
                  {item.has_document && (
                    <button type="button" className="text-[13px] font-medium text-sky-700 hover:underline" onClick={() => void showDoc(item)}>
                      {s.absenceShowDoc}
                    </button>
                  )}
                  {item.status === 'pending' && (
                    <button type="button" className="text-[13px] font-medium text-rose-600 hover:underline" onClick={() => void withdraw(item)}>
                      {s.absenceWithdraw}
                    </button>
                  )}
                </span>
                <div className="w-full text-[13px] text-slate-600">
                  {editingSub === item.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[260px] flex-1">
                        <SubstitutePicker value={subDraft} onChange={setSubDraft} />
                      </div>
                      <button type="button" className={BTN_SECONDARY} onClick={() => void saveSub(item)}>
                        {s.absenceSubSave}
                      </button>
                    </div>
                  ) : (
                    <span>
                      {s.absenceSubLabel}: <b>{item.substitute?.name || s.absenceSubNone}</b>{' '}
                      {item.status !== 'rejected' && (
                        <button
                          type="button"
                          className="ml-1 text-[13px] font-medium text-sky-700 hover:underline"
                          onClick={() => {
                            setEditingSub(item.id);
                            setSubDraft(item.substitute || null);
                          }}
                        >
                          {s.absenceSubChange}
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {item.decision_note && <p className="w-full text-[12.5px] text-slate-500">{item.decision_note}</p>}
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

function LibraryPanel() {
  const s = useSettingsText();
  const { language } = useUiText();
  const names = useLocalizedNames(language, [], true);
  const [data, setData] = useState<{ department: string; items: LibraryItem[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<'book' | 'protocol'>('book');
  const [title, setTitle] = useState('');
  // Bir nechta fayl birga (2026-11-25): navbat bilan bittadan yuklanadi.
  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] ?? null;
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tahrirlanayotgan hujjat: nom va tur shu yerda o'zgartiriladi.
  const [editing, setEditing] = useState<{ id: number; title: string; kind: 'book' | 'protocol' } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchLibrary());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, s.libraryLoadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Indekslanayotgan hujjat bo'lsa — holatini 10 soniyada bir yangilab turamiz.
  const processing = data?.items.some((i) => i.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    const id = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(id);
  }, [processing, load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    const failed: string[] = [];
    setProgress({ done: 0, total: files.length, failed });
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      try {
        // Nom faqat bitta fayl yuklanganda ishlatiladi; ko'p faylda — har birining o'z nomi.
        await uploadLibraryItem(f, kind, files.length === 1 ? title.trim() : '');
      } catch (err) {
        failed.push(`${f.name}: ${errorText(err, s.uploadError)}`);
      }
      setProgress({ done: i + 1, total: files.length, failed: [...failed] });
    }
    setFiles([]);
    setTitle('');
    if (inputRef.current) inputRef.current.value = '';
    setMsg(failed.length ? { kind: 'error', text: failed.join('\n') } : { kind: 'ok', text: s.uploaded });
    setBusy(false);
    await load();
  };

  const retry = async (item: LibraryItem) => {
    try {
      await reindexLibraryItem(item.id);
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.uploadError) });
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateLibraryItem(editing.id, { title: editing.title.trim(), kind: editing.kind });
      setEditing(null);
      setMsg({ kind: 'ok', text: s.renamed });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.renameError) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: LibraryItem) => {
    if (!window.confirm(s.deleteConfirm.replace('{title}', item.title))) return;
    try {
      await deleteLibraryItem(item.id);
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: errorText(err, s.deleteError) });
    }
  };

  const groups = useMemo(() => {
    const items = data?.items || [];
    return [
      { key: 'protocol', title: s.protocolsGroup, rows: items.filter((i) => i.kind === 'protocol') },
      { key: 'book', title: s.booksGroup, rows: items.filter((i) => i.kind !== 'protocol') },
    ];
  }, [data, s]);

  return (
    <Panel
      title={s.tabLibrary}
      intro={s.libraryIntro}
      howto={<HowTo steps={[s.libraryStep1, s.libraryStep2, s.libraryStep3]} note={s.libraryNote} />}
    >

      <section className={CARD}>
        <h3 className="text-[17px] font-bold text-slate-900">{s.uploadDoc}</h3>
        <p className="mt-1 text-[13px] text-slate-500">
          {s.department}:{' '}
          <b className="text-slate-700">
            {data?.department ? names.departmentName(data.department) ?? '…' : '—'}
          </b>
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {([
              ['book', s.kindBook],
              ['protocol', s.kindProtocol],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-lg px-4 py-2 text-[13px] font-semibold ${kind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {files.length <= 1 && (
            <input
              className={INPUT}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={s.titlePlaceholder}
            />
          )}
          {/* Brauzerning "Choose file / No file chosen" yozuvi o'rniga o'zbekcha tugma. */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.txt"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="hidden"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SECONDARY} onClick={() => inputRef.current?.click()}>
              <FileUp size={16} /> {s.chooseFile}
            </button>
            <span className="min-w-0 truncate text-[13px] text-slate-500">
              {files.length > 1
                ? `${files.length} · ${(files.reduce((a, f) => a + f.size, 0) / (1024 * 1024)).toFixed(1)} MB`
                : file
                  ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`
                  : s.fileHint}
            </span>
          </div>
          {files.length > 1 && (
            <ul className="max-h-40 overflow-auto rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
              {files.map((f) => (
                <li key={f.name} className="truncate">{f.name}</li>
              ))}
            </ul>
          )}
          <button type="submit" className={BTN_PRIMARY} disabled={!files.length || busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} {s.upload}
            {busy && progress ? ` ${progress.done}/${progress.total}` : ''}
          </button>
          {msg && <Message kind={msg.kind}><span className="whitespace-pre-line">{msg.text}</span></Message>}
        </form>
      </section>

      {loadError && <Message kind="error">{loadError}</Message>}
      {data &&
        groups.map((g) => (
          <section key={g.key} className={CARD}>
            <h3 className="mb-3 text-[15px] font-bold text-slate-900">
              {g.title} <span className="font-normal text-slate-400">{g.rows.length}</span>
            </h3>
            {g.rows.length === 0 ? (
              <p className="text-[13px] text-slate-400">{s.none}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {g.rows.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
                    {editing?.id === item.id ? (
                      <div className="min-w-0 flex-1 space-y-2">
                        <input
                          value={editing.title}
                          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                          aria-label={s.titleLabel}
                          maxLength={512}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px]"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={editing.kind}
                            onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'book' | 'protocol' })}
                            className="rounded-lg border border-slate-300 px-2 py-1.5 text-[13px]"
                          >
                            <option value="book">{s.kindBook}</option>
                            <option value="protocol">{s.kindProtocol}</option>
                          </select>
                          <button type="button" className={BTN_PRIMARY} disabled={busy || editing.title.trim().length < 3} onClick={() => void saveEdit()}>
                            {busy ? <Loader2 size={16} className="animate-spin" /> : null} {s.save}
                          </button>
                          <button type="button" className="rounded-lg px-3 py-2 text-[13px] text-slate-500 hover:bg-slate-100" onClick={() => setEditing(null)}>
                            {s.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-slate-800" title={item.title}>{item.title}</p>
                      <p className="text-[12px] text-slate-400">
                        <span
                          className={
                            item.status === 'ready'
                              ? 'text-emerald-600'
                              : item.status === 'failed'
                                ? 'text-rose-600'
                                : 'text-amber-600'
                          }
                        >
                          {STATUS_KEY[item.status] ? s[STATUS_KEY[item.status]] : item.status}
                        </span>
                        {item.status_note ? ` — ${item.status_note}` : ''}
                        {item.uploader_name ? ` · ${item.uploader_name}` : ''}
                      </p>
                    </div>
                    )}
                    {item.can_delete && editing?.id !== item.id && (
                      <div className="flex shrink-0 items-center">
                        {item.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => void retry(item)}
                            className="rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-sky-700 hover:bg-sky-50"
                          >
                            ↻
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditing({ id: item.id, title: item.title, kind: item.kind === 'protocol' ? 'protocol' : 'book' })}
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={s.edit}
                          title={s.edit}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(item)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label={s.delete}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
    </Panel>
  );
}

// ============================================================ Kirish va xavfsizlik

function AccessPanel() {
  const s = useSettingsText();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  /** Profil yuklanmasa "bog'lanmagan" deb ko'rsatilmaydi — bu yolg'on bo'lardi
   *  va o'qituvchi yuzini qayta ro'yxatdan o'tkazishga urinardi (2026-11-17 audit). */
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(() => {
    setLoadFailed(false);
    void fetchMyProfile()
      .then(setProfile)
      .catch(() => {
        setProfile(null);
        setLoadFailed(true);
      });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (loadFailed) {
    return (
      <Panel
        title={s.tabAccess}
        intro={s.accessIntro}
        howto={<HowTo steps={[s.accessStep1, s.accessStep2, s.accessStep3]} />}
      >
        <section className={CARD} role="alert">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-rose-700">{s.accessLoadFailed}</p>
            <button type="button" onClick={load} className={BTN_SECONDARY}>
              {s.accessRetry}
            </button>
          </div>
        </section>
      </Panel>
    );
  }

  const Status = ({ ok, yes, no }: { ok: boolean | undefined; yes: string; no: string }) => (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>
      {ok ? <CheckCircle2 size={15} /> : null}
      {ok ? yes : no}
    </span>
  );

  return (
    <Panel
      title={s.tabAccess}
      intro={s.accessIntro}
      howto={<HowTo steps={[s.accessStep1, s.accessStep2, s.accessStep3]} />}
    >
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ScanFace className="mt-0.5 text-sky-600" size={22} />
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">{s.faceTitle}</h3>
              <Status ok={profile?.face_linked} yes={s.faceLinked} no={s.faceNotLinked} />
            </div>
          </div>
          {!profile?.face_linked && (
            <a href={FACE_REGISTRATION_URL} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
              {s.faceRegister} <ExternalLink size={14} />
            </a>
          )}
        </div>
      </section>
      <section className={CARD}>
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 text-sky-600" size={22} />
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">{s.pinflTitle}</h3>
            <Status
              ok={profile?.pinfl_linked}
              yes={s.pinflLinked}
              no={s.pinflNotLinked}
            />
            <p className="mt-2 text-[13px] text-slate-500">{s.pinflPassword}</p>
          </div>
        </div>
      </section>
      <AccountSecurityCard s={s} />
    </Panel>
  );
}

// ============================================================ asosiy

export default function TeacherSettings() {
  const [tab, setTab] = useState<Tab>(readTab);
  const s = useSettingsText();

  const choose = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* muhim emas */
    }
  };

  return (
    <StaffPageLayout
      title={s.pageTitle}
      subtitle={s.pageSubtitle}
      icon={Settings}
      accent="slate"
    >
      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Bo'limlar: kompyuterda chapda ro'yxat, telefonda tepada gorizontal. */}
        <nav
          className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0"
          role="tablist"
          aria-label={s.navAria}
        >
          {TABS.map(({ id, label, hint, icon: Icon }) => {
            const on = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => choose(id)}
                className={`flex shrink-0 items-start gap-3 rounded-xl px-3 py-2.5 text-left transition lg:w-full ${
                  on ? 'bg-white shadow-sm ring-1 ring-slate-900/10' : 'text-slate-600 hover:bg-white/70'
                }`}
              >
                <Icon size={18} className={`mt-0.5 shrink-0 ${on ? 'text-slate-900' : 'text-slate-400'}`} />
                <span className="min-w-0">
                  <span className={`block text-[14px] font-semibold ${on ? 'text-slate-900' : 'text-slate-700'}`}>{s[label]}</span>
                  <span className="hidden text-[12px] leading-snug text-slate-400 lg:block">{s[hint]}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {tab === 'profile' && <ProfilePanel />}
          {tab === 'subjects' && <SubjectsPanel />}
          {tab === 'library' && <LibraryPanel />}
          {tab === 'absence' && <AbsencePanel />}
          {tab === 'access' && <AccessPanel />}
        </div>
      </div>
    </StaffPageLayout>
  );
}
