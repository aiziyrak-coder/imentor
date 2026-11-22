import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Filter } from 'lucide-react';
import type { ControlTeacher } from './rectorApi';
import type { Person } from './PersonPanel';

/**
 * Fakultet → kafedra → o'qituvchi kesimi (2026-11-16). Rektor: "fakultetlar, kafedralar kesimida
 * saralay olishimiz kerak"; keyin: "kafedraga kirganda kimlarga tegishli ekani, qaysi o'qituvchiligi
 * chiqsin va uning ichiga ham kirsa bo'lsin".
 *
 * * Fakultet qatori — kafedralarini yig'adi/ochadi.
 * * Kafedra qatori — o'qituvchilari ro'yxatini ochadi (holati va o'tgan/jami darsi bilan).
 * * O'qituvchi — bosilsa uning to'liq hisoboti (PersonPanel).
 * * Voronka tugmasi — butun sahifani shu fakultet / kafedraga filtrlaydi.
 */

export type SectionRow = {
  teachers: number;
  used: number;
  percent: number;
  full: number;
  partial: number;
  opened: number;
  none: number;
};
export type Section = SectionRow & {
  faculty: string;
  departments: Array<SectionRow & {
    department: string;
    teacher_keys?: string[];
    /** Klinik fanning amaliy darslari (monitorli/monitorsiz) — monitorli darsi yo'q kafedrani tushuntirish uchun. */
    clinical_lessons?: number;
    clinical_teachers?: number;
    monitor_lessons?: number;
    rooms_without_monitor?: Array<{ room: string; lessons: number }>;
    /** Klinik amaliy darsi bor hamma o'qituvchi (monitorsiz xonadagilar ham). */
    clinical_teacher_keys?: string[];
    /** Nazoratga kirmaydi: klinik fan darsi yo'q yoki hisobotdan chiqarilgan kafedra. */
    reason?: 'no_clinical' | 'excluded';
  }>;
};

type Dept = Section['departments'][number];

/** Klinik darsi bor, lekin birortasi monitorli xonada emas — nima uchun bo'shligi va qayerda o'tgani. */
function NoMonitor({ d, open, onToggle, teachers, onOpenPerson }: {
  d: Dept;
  open: boolean;
  onToggle: () => void;
  teachers: Map<string, ControlTeacher>;
  onOpenPerson?: (p: Person) => void;
}) {
  const people = (d.clinical_teacher_keys || [])
    .map((k) => teachers.get(k) || { teacher_key: k.startsWith('name:') ? '' : k, teacher_name: k.replace(/^name:/, '') } as ControlTeacher)
    .sort((a, b) => a.teacher_name.localeCompare(b.teacher_name));
  return (
    <div>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl py-1.5 pl-5 pr-3 text-left transition hover:bg-slate-50">
        {open ? <ChevronDown size={15} className="shrink-0 text-slate-400" /> : <ChevronRight size={15} className="shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] text-slate-500">{d.department}</span>
          <span className="block text-[11.5px] text-amber-700">monitorli xonada darsi yo‘q · {d.clinical_teachers ?? 0} o‘qituvchi, {d.clinical_lessons ?? 0} klinik dars boshqa xonalarda</span>
        </span>
        <span className="shrink-0 text-[14px] font-bold text-slate-300">—</span>
      </button>
      {open && (
        <div className="mb-1.5 ml-9 mr-1 rounded-xl bg-amber-50/60 px-3 py-2 text-[12.5px] text-amber-950 ring-1 ring-amber-100">
          <p>Bu kafedraning klinik amaliy darslari quyidagi xonalarda o‘tgan, ularda monitor belgilanmagan:</p>
          <ul className="mt-1 space-y-0.5">
            {(d.rooms_without_monitor || []).map((r) => (
              <li key={r.room} className="flex justify-between gap-2"><span className="truncate">{r.room}</span><b className="shrink-0 tabular-nums">{r.lessons} dars</b></li>
            ))}
          </ul>
          <p className="mt-1.5 text-amber-800">Shu xonalarda monitor bo‘lsa — admin panelidagi «Monitorli xonalar»da belgilang, darslar darhol nazoratga kiradi.</p>
          {people.length > 0 && (
            <>
              <p className="mt-2 font-semibold text-amber-900">O‘qituvchilar ({people.length}):</p>
              <ul className="mt-1 divide-y divide-amber-100 rounded-lg bg-white/70">
                {people.map((t) => {
                  const canOpen = !!(onOpenPerson && t.teacher_key);
                  return (
                    <li key={t.teacher_key || t.teacher_name}>
                      <button type="button" disabled={!canOpen}
                        onClick={() => canOpen && onOpenPerson?.({ kind: 'teacher', key: t.teacher_key, name: t.teacher_name })}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-slate-800 hover:bg-white disabled:cursor-default">
                        <span className="min-w-0 flex-1 truncate font-semibold">{t.teacher_name}</span>
                        {typeof t.other_lessons === 'number' && <span className="shrink-0 text-[11.5px] text-slate-500">{t.other_lessons} dars monitorsiz xonada</span>}
                        {canOpen && <ChevronRight size={14} className="shrink-0 text-slate-300" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const tone = (p: number) => (p >= 70 ? 'text-emerald-600' : p >= 40 ? 'text-amber-600' : 'text-rose-600');

const STATE: Record<string, { label: string; cls: string; order: number }> = {
  none: { label: 'Umuman ochmagan', cls: 'bg-rose-50 text-rose-700 ring-rose-200', order: 0 },
  partial: { label: 'Dars qoldirgan', cls: 'bg-orange-50 text-orange-700 ring-orange-200', order: 1 },
  opened: { label: 'Kirib chiqqan', cls: 'bg-amber-50 text-amber-700 ring-amber-200', order: 2 },
  full: { label: 'Hammasini o‘tgan', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', order: 3 },
  on_leave: { label: 'Ta’tilda', cls: 'bg-slate-100 text-slate-600 ring-slate-200', order: 4 },
  unlinked: { label: 'Hisobi yo‘q', cls: 'bg-slate-100 text-slate-600 ring-slate-200', order: 5 },
};

const keyOf = (t: ControlTeacher) => t.teacher_key || `name:${t.teacher_name}`;

function Bar({ r }: { r: SectionRow }) {
  const parts: Array<[number, string]> = [
    [r.full, 'bg-emerald-400'],
    [r.opened, 'bg-amber-400'],
    [r.partial, 'bg-orange-400'],
    [r.none, 'bg-rose-400'],
  ];
  const total = Math.max(1, r.teachers);
  return (
    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
      {parts.map(([n, c], i) => n > 0 && <span key={i} className={c} style={{ width: `${(100 * n) / total}%` }} />)}
    </span>
  );
}

function Row({ name, r, strong, open, active, onToggle, onFilter }: {
  name: string;
  r: SectionRow;
  strong?: boolean;
  open: boolean;
  active: boolean;
  onToggle: () => void;
  onFilter?: () => void;
}) {
  return (
    <div className={`group flex items-center gap-1 rounded-xl transition hover:bg-slate-50 ${active ? 'bg-indigo-50 ring-1 ring-indigo-200' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        title={`${r.teachers} o‘qituvchi: hammasini o‘tgan ${r.full}, dars qoldirgan ${r.partial}, kirib chiqqan ${r.opened}, umuman ochmagan ${r.none}`}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 text-left ${strong ? 'py-2.5' : 'py-1.5 pl-5'}`}>
        {open ? <ChevronDown size={15} className="shrink-0 text-slate-400" /> : <ChevronRight size={15} className="shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${strong ? 'text-[14.5px] font-bold text-slate-900' : 'text-[13.5px] text-slate-700'}`}>{name}</span>
          <span className="mt-1 block"><Bar r={r} /></span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`block font-bold rx-num ${strong ? 'text-[17px]' : 'text-[14.5px]'} ${tone(r.percent)}`}>{r.percent}%</span>
          <span className="block text-[11.5px] text-slate-500 rx-num">{r.used}/{r.teachers}</span>
        </span>
      </button>
      {onFilter && (
        <button type="button" onClick={onFilter} title="Butun hisobotni shunga filtrlash" aria-label={`${name} bo‘yicha filtrlash`}
          className={`mr-1 shrink-0 rounded-lg p-1.5 transition hover:bg-indigo-100 hover:text-indigo-700 ${active ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-500'}`}>
          <Filter size={14} />
        </button>
      )}
    </div>
  );
}

function TeacherList({ keys, teachers, onOpenPerson }: {
  keys: string[];
  teachers: Map<string, ControlTeacher>;
  onOpenPerson?: (p: Person) => void;
}) {
  const list = keys
    .map((k) => teachers.get(k))
    .filter((t): t is ControlTeacher => !!t)
    .sort((a, b) => (STATE[a.state || '']?.order ?? 9) - (STATE[b.state || '']?.order ?? 9)
      || (b.monitor_missed ?? 0) - (a.monitor_missed ?? 0) || a.teacher_name.localeCompare(b.teacher_name));
  if (!list.length) return <p className="py-2 pl-12 text-[13px] text-slate-400">O‘qituvchilar ro‘yxati yo‘q</p>;
  return (
    <ul className="mb-1.5 ml-9 mr-1 divide-y divide-slate-100 rounded-xl bg-slate-50/70 ring-1 ring-slate-100">
      {list.map((t) => {
        const st = STATE[t.state || ''] || STATE.none;
        const canOpen = !!(onOpenPerson && t.teacher_key);
        return (
          <li key={keyOf(t)}>
            <button type="button" disabled={!canOpen}
              onClick={() => canOpen && onOpenPerson?.({ kind: 'teacher', key: t.teacher_key, name: t.teacher_name })}
              className="group/t flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-white disabled:cursor-default">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[12px] font-bold text-slate-500 ring-1 ring-slate-200">
                {t.teacher_name.trim().charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-slate-800">{t.teacher_name}</span>
                <span className={`mt-0.5 inline-block rounded-full px-2 py-px text-[11px] font-semibold ring-1 ${st.cls}`}>{st.label}</span>
              </span>
              <span className="shrink-0 text-right text-[12px] text-slate-500 rx-num" title="iMentor’da o‘tgan / nazoratdagi darslari">
                <b className="text-[13.5px] text-slate-800">{t.monitor_used}</b>/{t.monitor_lessons} dars
              </span>
              {canOpen && <ChevronRight size={15} className="shrink-0 text-slate-300 transition group-hover/t:translate-x-0.5 group-hover/t:text-indigo-500" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default function SectionsCard({ sections, teachers = [], department = '', onDepartment, onOpenPerson }: {
  sections: Section[];
  /** Hisobotdagi o'qituvchi qatorlari — kafedra ochilganda ismlar shulardan. */
  teachers?: ControlTeacher[];
  department?: string;
  onDepartment?: (value: string) => void;
  onOpenPerson?: (p: Person) => void;
}) {
  const byKey = useMemo(() => new Map(teachers.map((t) => [keyOf(t), t])), [teachers]);
  const [closedFac, setClosedFac] = useState<Set<string>>(new Set());
  const [openDep, setOpenDep] = useState<Set<string>>(new Set());
  // Bitta kafedra qolgan bo'lsa (filtr tanlangan) — o'qituvchilari darhol ko'rinsin.
  useEffect(() => {
    const deps = sections.flatMap((s) => s.departments).filter((d) => d.teachers > 0);
    if (deps.length === 1) setOpenDep(new Set([deps[0].department]));
  }, [sections]);
  const flip = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };

  return (
    <div className="ios-card rx-low flex min-h-[220px] min-w-0 flex-col p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[17px] font-bold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500"><Building2 size={17} /></span>
          Fakultet va kafedralar kesimi
        </h3>
        {department && onDepartment && (
          <button type="button" onClick={() => onDepartment('')}
            className="rounded-full bg-slate-100 px-3 py-1 text-[13px] font-semibold text-slate-600 hover:bg-slate-200">
            Hammasini ko‘rsatish
          </button>
        )}
      </div>
      <p className="mb-2 text-[12.5px] text-slate-500">
        iMentor’da dars o‘tgan o‘qituvchilar / nazoratdagilar. Kafedrani bossangiz — o‘qituvchilari, o‘qituvchini bossangiz — uning hisoboti.
        <Filter size={11} className="mx-1 inline align-[-1px]" /> — butun hisobotni filtrlash.
      </p>
      {sections.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-[14px] text-slate-400">Bu davrda nazoratdagi dars yo‘q</div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {sections.map((s) => {
            const facOpen = !closedFac.has(s.faculty);
            return (
              <div key={s.faculty}>
                <Row name={s.faculty} r={s} strong open={facOpen} active={department === s.faculty}
                  onToggle={() => setClosedFac((c) => flip(c, s.faculty))}
                  onFilter={onDepartment && s.faculty !== 'Boshqa' ? () => onDepartment(s.faculty) : undefined} />
                {facOpen && s.departments.map((d) => {
                  const depOpen = openDep.has(d.department);
                  if (!d.teachers && !d.clinical_lessons) {
                    // Nazoratga kirmaydigan kafedra — ro'yxatda sababi bilan turadi (2026-11-16: "hamma kafedralar chiqsin").
                    return (
                      <div key={d.department} className="flex items-center gap-2.5 py-1.5 pl-5 pr-3">
                        <span className="w-[15px] shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] text-slate-400">{d.department}</span>
                          <span className="block text-[11.5px] text-slate-400">
                            {d.reason === 'excluded' ? 'hisobotdan chiqarilgan kafedra — nazoratda emas' : 'nazoratdagi fan darsi yo‘q — nazoratda emas'}
                          </span>
                        </span>
                        <span className="shrink-0 text-[14px] font-bold text-slate-200">—</span>
                      </div>
                    );
                  }
                  if (!d.teachers && d.clinical_lessons) {
                    return <NoMonitor key={d.department} d={d} open={depOpen} onToggle={() => setOpenDep((c) => flip(c, d.department))}
                      teachers={byKey} onOpenPerson={onOpenPerson} />;
                  }
                  // Kesim butun institutni ko'rsatadi (2026-11-17), o'qituvchi qatorlari esa faqat filtrdagilar.
                  // Filtrdan tashqaridagi kafedra bosilsa — hisobot o'sha kafedraga o'tadi va ro'yxat ochiladi.
                  const outside = !!department && !!onDepartment
                    && !(d.teacher_keys || []).some((k) => byKey.has(k));
                  return (
                    <div key={d.department}>
                      <Row name={d.department} r={d} open={depOpen && !outside} active={department === d.department}
                        onToggle={() => (outside ? onDepartment?.(d.department) : setOpenDep((c) => flip(c, d.department)))}
                        onFilter={onDepartment ? () => onDepartment(d.department) : undefined} />
                      {depOpen && <TeacherList keys={d.teacher_keys || []} teachers={byKey} onOpenPerson={onOpenPerson} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
