import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BellRing,
  ChevronDown,
  ChevronUp,
  Clock3,
  MessageSquareText,
  PhoneCall,
  PhoneOff,
  Send,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { HttpError } from '../api/httpClient';
import {
  fetchTelegramBot,
  type BotDepartment,
  type BotFeedItem,
  type BotResponsible,
  type BotStatus,
  type BotTeacher,
  type ReportFilters,
  type TelegramBotReport as Report,
} from './rectorApi';
import { SortableTable, type Column } from './RectorUi';
import { Avatar, EmptyNote, KpiCard, Panel, Pill, Ring, Segmented, Skeleton, StackBar, toneOf, uzDay, type Tone } from './RectorViz';

/**
 * «Telegram bot» sahifasi (2026-11-18).
 *
 * Birinchi ko'rinish matnga to'la edi — foydalanuvchi: "judayam yomon, tushunarsiz, text text bo'lib ketgan; har bir
 * mas'ul bo'yicha ish faoliyati, unumdorligi, statistikasi, analitikasi alohida-alohida kartalarda chiqsin".
 * Endi: tepada 5 ta ko'rsatkich, asosiy qism — HAR MAS'UL alohida karta (unumdorlik halqasi, raqamlar, post turlari,
 * kunlar, bog'lanilmagan o'qituvchilar). Kafedralar, o'qituvchilar va postlar lentasi — «Batafsil» ostida.
 * Hammasi botning o'z yozuvlaridan (guruhga nima ketgan bo'lsa — shu).
 */
const STATUS: Record<BotStatus, { label: string; tone: Tone }> = {
  never: { label: 'Dars davomida ochmadi', tone: 'rose' },
  opened: { label: 'Keyin ochdi', tone: 'emerald' },
  offsite: { label: 'Boshqa joyda', tone: 'sky' },
  pending: { label: 'Dars davom etmoqda', tone: 'amber' },
  left: { label: 'Chiqib ketdi', tone: 'orange' },
  returned: { label: 'Chiqib, qaytdi', tone: 'teal' },
  short: { label: 'To‘liq o‘tilmadi (40 daq dan kam)', tone: 'violet' },
  misuse: { label: 'Test/keys yaratmadi', tone: 'amber' },
};

/** Post turlari — kartadagi rangli chiziq va izoh (tartibi bir xil). */
const TYPE_PARTS: Array<{ key: 'never' | 'pending' | 'left' | 'short' | 'misuse' | 'returned' | 'opened'; label: string; tone: Tone }> = [
  { key: 'never', label: 'Ochmadi', tone: 'rose' },
  { key: 'pending', label: 'Davom etmoqda', tone: 'amber' },
  { key: 'left', label: 'Chiqib ketdi', tone: 'orange' },
  { key: 'short', label: '40 daq dan kam', tone: 'violet' },
  { key: 'misuse', label: 'Test/keys yo‘q', tone: 'amber' },
  { key: 'returned', label: 'Qaytdi', tone: 'teal' },
  { key: 'opened', label: 'O‘zi ochdi', tone: 'emerald' },
];

const DOT: Record<Tone, string> = {
  indigo: 'bg-indigo-500', violet: 'bg-violet-500', sky: 'bg-sky-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
  orange: 'bg-orange-500', rose: 'bg-rose-500', slate: 'bg-slate-400', teal: 'bg-teal-500',
};

type FeedFilter = 'all' | 'never' | 'left' | 'short' | 'misuse' | 'uncalled' | 'comments';
type PersonFilter = 'all' | 'missed' | 'unregistered';

function shortDay(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}.${m}` : iso;
}

function MiniStat({ label, value, tone = 'slate' }: { label: string; value: React.ReactNode; tone?: 'slate' | 'rose' | 'emerald' }) {
  const color = tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : 'text-slate-900';
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-900/[0.04]">
      <p className={`text-[19px] font-extrabold leading-none rx-num ${color}`}>{value}</p>
      <p className="mt-1 text-[10.5px] font-medium leading-tight text-slate-500">{label}</p>
    </div>
  );
}

function PersonCard({ p, delay }: { p: BotResponsible; delay: number }) {
  const [open, setOpen] = useState(false);
  const rate = p.effective_rate ?? null;
  const tone: Tone = !p.posts ? 'slate' : rate === null ? 'emerald' : toneOf(rate);
  const types = p.types || {};
  const days = p.daily || [];
  const peak = Math.max(1, ...days.map((d) => d.posts));
  const accent = { emerald: 'from-emerald-400 to-green-500', amber: 'from-amber-400 to-orange-500', rose: 'from-rose-500 to-pink-600' } as Record<string, string>;
  return (
    <article
      className="rx-card rx-rise relative flex flex-col overflow-hidden"
      style={{ ['--rx-delay' as string]: `${delay}ms` } as React.CSSProperties}
      data-testid="bot-person-card"
    >
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent[tone] || 'from-slate-300 to-slate-400'}`} />
      <header className="flex items-start gap-3 px-4 pt-4">
        <Avatar name={p.name} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15.5px] font-bold text-slate-900">{p.name}</h3>
          <p className="line-clamp-2 text-[11.5px] leading-snug text-slate-500" title={p.departments.join(', ')}>
            {p.departments.join(' · ') || '—'}
          </p>
        </div>
        {p.registered ? (
          <Pill tone="emerald"><UserCheck size={11} /> botda</Pill>
        ) : (
          <Pill tone="slate"><UserX size={11} /> tanitilmagan</Pill>
        )}
      </header>

      {p.posts ? (
        <>
          <div className="flex items-center gap-4 px-4 pt-3">
            <span title={`Unumdorlik: bog‘lanish kerak bo‘lgan ${p.needed ?? 0} holatdan ${p.contacted} tasida «Bog‘landim» bosilgan`}>
            <Ring value={rate ?? 100} size={92} stroke={10} tone={tone}>
              <span className="text-[20px] font-extrabold leading-none text-slate-900 rx-num">{rate === null ? '—' : `${rate}%`}</span>
              <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">unumdorlik</span>
            </Ring>
            </span>
            <div className="grid flex-1 grid-cols-3 gap-1.5">
              <MiniStat label="post" value={p.posts} />
              <MiniStat label="bog‘landi" value={p.contacted} tone="emerald" />
              <MiniStat label="bog‘lanmadi" value={p.missed_count} tone={p.missed_count ? 'rose' : 'slate'} />
              <MiniStat label="odatda, daq" value={p.median_minutes ?? '—'} />
              <MiniStat label="eslatma" value={p.reminders} />
              <MiniStat label="izoh" value={p.comments} />
            </div>
          </div>

          <div className="px-4 pt-3">
            <StackBar
              height={10}
              parts={TYPE_PARTS.map((t) => ({ key: t.key, value: types[t.key] || 0, tone: t.tone, title: `${t.label}: ${types[t.key] || 0}` }))}
            />
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {TYPE_PARTS.filter((t) => types[t.key]).map((t) => (
                <li key={t.key} className="flex items-center gap-1 text-[11px] text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${DOT[t.tone]}`} />
                  {t.label} <b className="rx-num">{types[t.key]}</b>
                </li>
              ))}
            </ul>
          </div>

          {days.length > 1 && (
            <div className="flex items-end gap-1 px-4 pt-3" aria-label="Kunlar bo‘yicha">
              {days.map((d) => (
                <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={`${uzDay(d.day)}: ${d.posts} post, ${d.contacted} bog‘landi`}>
                  <div className="flex h-10 w-full items-end justify-center">
                    <div className="relative w-full max-w-[18px] rounded-t bg-slate-200" style={{ height: `${Math.max(8, (100 * d.posts) / peak)}%` }}>
                      <div className="absolute inset-x-0 bottom-0 rounded-t bg-emerald-500" style={{ height: `${d.posts ? (100 * d.contacted) / d.posts : 0}%` }} />
                    </div>
                  </div>
                  <span className="text-[9.5px] text-slate-400">{shortDay(d.day)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-auto px-4 pb-3 pt-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              disabled={!p.missed.length}
              className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-900/[0.05] transition hover:bg-slate-100 disabled:cursor-default disabled:opacity-60"
            >
              <span className="flex items-center gap-1.5">
                <PhoneOff size={13} className={p.missed.length ? 'text-rose-500' : 'text-slate-400'} />
                Bog‘lanilmagan o‘qituvchilar ({p.missed_count})
              </span>
              {p.missed.length ? (open ? <ChevronUp size={15} /> : <ChevronDown size={15} />) : null}
            </button>
            {open && (
              <ul className="mt-2 space-y-1.5" data-testid="bot-person-missed">
                {p.missed.map((m, i) => (
                  <li key={i} className="rounded-lg bg-white px-2.5 py-1.5 text-[12px] ring-1 ring-slate-900/[0.06]">
                    <span className="font-semibold text-slate-900">{m.name}</span>
                    <span className="ml-1 text-slate-400 rx-num">{shortDay(m.day)} · {m.para} ({m.slot})</span>
                    <span className="block text-[11px] text-slate-500">
                      {m.department} · <span className={`font-medium ${m.status === 'never' ? 'text-rose-600' : 'text-orange-600'}`}>{STATUS[m.status]?.label || m.status}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="mt-auto px-4 pb-4 pt-6 text-center text-[12.5px] text-slate-400">Tanlangan davrda post yo‘q</p>
      )}
    </article>
  );
}

function FeedCard({ item }: { item: BotFeedItem }) {
  const look = STATUS[item.status];
  return (
    <li className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-900/[0.06]" data-testid="bot-feed-item">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12px] font-semibold text-slate-400 rx-num">
          {shortDay(item.day)} · {item.para} ({item.slot})
        </span>
        {item.late_data ? (
          <Pill tone="sky">O‘z vaqtida ochgan · ma’lumot kech yetdi</Pill>
        ) : (
          <Pill tone={look.tone}>
            {look.label}
            {item.status === 'opened' && item.late !== null ? ` · ${item.late} daq kech` : ''}
          </Pill>
        )}
        {item.private_copy && (
          <span title="Mas’ulga shaxsiy xabar ham ketgan" className="inline-flex items-center gap-1 text-[11px] text-slate-400">
            <Send size={11} /> shaxsiy
          </span>
        )}
      </div>
      <p className="mt-1 text-[14px] font-bold text-slate-900">{item.name}</p>
      <p className="text-[12px] text-slate-500">{item.department}{item.rooms.length ? ` · ${item.rooms.join(', ')}` : ''}</p>
      {item.alert === 'left' && (
        <p className="mt-1 text-[12px] text-orange-700">🚪 {item.since} dan faollik yo‘q{item.returned_at ? ` · ${item.returned_at} da qaytdi` : ''}</p>
      )}
      {item.alert === 'short' && <p className="mt-1 text-[12px] text-violet-700">⏱ iMentor’da {item.minutes ?? 0} daqiqa ishladi</p>}
      {item.alert === 'misuse' && (
        <p className="mt-1 text-[12px] text-amber-800">
          ⚠️ {(item.gaps || []).map((g) => (g === 'test' ? 'test yaratilmadi' : g === 'case' ? 'keys yaratilmadi'
            : g === 'test_time' ? `testga ${item.test_minutes ?? 0} daq` : `keysga ${item.case_minutes ?? 0} daq`)).join(', ')}
        </p>
      )}
      {item.contact && (
        <p className="mt-1.5 text-[12px] text-slate-600">
          <span className="text-slate-400">Mas’ul:</span> <b>{item.contact}</b>
          {item.calls.length ? (
            <span className="ml-1.5 text-emerald-700">
              — <PhoneCall size={11} className="inline" /> {item.calls.map((c) => c.at).join(', ')}
              {item.minutes_to_call !== null ? ` (${item.minutes_to_call} daq)` : ''}
            </span>
          ) : ['never', 'pending', 'left', 'short', 'misuse'].includes(item.status) ? (
            <span className="ml-1.5 text-rose-600">— bog‘lanmagan</span>
          ) : null}
        </p>
      )}
      {item.comments.map((c, i) => (
        <p key={i} className="mt-1 rounded-xl bg-slate-50 px-3 py-1.5 text-[12px] text-slate-700">
          <MessageSquareText size={12} className="mr-1 inline text-slate-400" />
          <b>{c.by}</b> <span className="text-slate-400">({c.at})</span>: {c.text}
        </p>
      ))}
    </li>
  );
}

export default function TelegramBotReport({
  filters,
  onUnauthorized,
  onBack,
}: {
  filters: ReportFilters;
  onUnauthorized: () => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [personFilter, setPersonFilter] = useState<PersonFilter>('all');
  const [details, setDetails] = useState(false);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [feedLimit, setFeedLimit] = useState(30);

  useEffect(() => {
    let alive = true;
    setError('');
    fetchTelegramBot(filters)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (e instanceof HttpError && e.status === 403) {
          if (alive) setError('Bu sahifa faqat rektor uchun.');
        } else if (/401/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [filters, onUnauthorized]);

  const people = useMemo(() => {
    const rows = data?.responsible || [];
    if (personFilter === 'missed') return rows.filter((r) => r.missed_count > 0);
    if (personFilter === 'unregistered') return rows.filter((r) => !r.registered);
    return rows;
  }, [data, personFilter]);

  const feed = useMemo(() => {
    const rows = data?.feed || [];
    if (feedFilter === 'never') return rows.filter((r) => r.status === 'never');
    if (feedFilter === 'left') return rows.filter((r) => r.status === 'left' || r.status === 'returned');
    if (feedFilter === 'short') return rows.filter((r) => r.status === 'short');
    if (feedFilter === 'misuse') return rows.filter((r) => r.status === 'misuse');
    if (feedFilter === 'uncalled') return rows.filter((r) => r.contact && !r.calls.length && ['never', 'pending', 'left', 'short', 'misuse'].includes(r.status));
    if (feedFilter === 'comments') return rows.filter((r) => r.comments.length);
    return rows;
  }, [data, feedFilter]);

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={onBack}
        className="ios-press inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[15px] font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200"
      >
        <ArrowLeft size={17} />
        Tizimlar
      </button>
      <div className="min-w-0">
        <h2 className="text-[22px] font-bold tracking-tight text-slate-900 sm:text-[24px]">Telegram bot — mas’ullar faoliyati</h2>
        <p className="text-[12.5px] text-slate-500">@imentor_fermi_bot · «iMentor Hisobot» guruhi</p>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-3">
        {header}
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">
          {error.startsWith('Bu sahifa') ? error : `Ma’lumot kelmadi: ${error}`}
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3">
        {header}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[118px]" />)}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[330px]" />)}</div>
      </div>
    );
  }

  const s = data.summary;
  const missedTotal = data.responsible.reduce((n, r) => n + r.missed_count, 0);
  const neededTotal = data.responsible.reduce((n, r) => n + (r.needed ?? 0), 0);
  const effective = neededTotal ? Math.round((100 * s.contacted) / neededTotal) : null;

  const depColumns: Array<Column<BotDepartment>> = [
    {
      key: 'department', label: 'Kafedra', value: (r) => r.department,
      render: (r) => (
        <span>
          <span className="font-semibold text-slate-900">{r.department}</span>
          <span className="block text-[11.5px] text-slate-500">{r.faculty}{r.contact ? ` · mas’ul: ${r.contact}` : ''}</span>
        </span>
      ),
    },
    { key: 'posts', label: 'Postlar', align: 'right', value: (r) => r.posts },
    { key: 'teachers', label: 'O‘qituvchi', align: 'right', value: (r) => r.teachers },
    {
      key: 'never', label: 'Ochmadi', align: 'right', value: (r) => r.never,
      render: (r) => <span className={`rx-num font-semibold ${r.never ? 'text-rose-600' : 'text-slate-400'}`}>{r.never}</span>,
    },
    { key: 'opened', label: 'Keyin ochdi', align: 'right', value: (r) => r.opened },
    { key: 'contact_rate', label: 'Bog‘landi', align: 'right', value: (r) => r.contact_rate, render: (r) => <span className="rx-num">{r.contacted} · {r.contact_rate}%</span> },
  ];
  const teacherColumns: Array<Column<BotTeacher>> = [
    {
      key: 'name', label: 'O‘qituvchi', value: (r) => r.name,
      render: (r) => (
        <span>
          <span className="font-semibold text-slate-900">{r.name}</span>
          <span className="block text-[11.5px] text-slate-500">{r.department}</span>
        </span>
      ),
    },
    { key: 'posts', label: 'Post', align: 'right', value: (r) => r.posts },
    {
      key: 'never', label: 'Ochmadi', align: 'right', value: (r) => r.never,
      render: (r) => <span className={`rx-num font-semibold ${r.never ? 'text-rose-600' : 'text-slate-400'}`}>{r.never}</span>,
    },
    { key: 'opened', label: 'Keyin ochdi', align: 'right', value: (r) => r.opened },
    { key: 'avg_late', label: 'O‘rtacha kech (daq)', align: 'right', value: (r) => r.avg_late },
    { key: 'contacted', label: 'Bog‘lanildi', align: 'right', value: (r) => r.contacted },
  ];

  return (
    <div className="space-y-4" data-testid="telegram-bot-report">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard icon={BellRing} tone="indigo" label="Postlar" value={s.posts}
          sub={`${s.teachers} o‘qituvchi · ochmadi ${s.never + s.pending} · chiqib ketdi ${s.left ?? 0} · 40 daq dan kam ${s.short ?? 0}`} />
        <KpiCard icon={PhoneCall} tone={effective === null ? 'slate' : toneOf(effective)} label="Mas’ullar unumdorligi"
          value={effective === null ? '—' : `${effective}%`} sub={`kerak bo‘lgan ${neededTotal} holatdan ${s.contacted} tasida bog‘landi`} delay={40} />
        <KpiCard icon={PhoneOff} tone={missedTotal ? 'rose' : 'emerald'} label="Bog‘lanilmagan holatlar" value={missedTotal}
          sub="o‘qituvchi ochmagan / chiqib ketgan, «Bog‘landim» bosilmagan" delay={80} />
        <KpiCard icon={Clock3} tone="amber" label="Odatda bog‘lanish vaqti" value={s.median_minutes !== null ? `${s.median_minutes} daq` : '—'}
          sub="post chiqqanidan «Bog‘landim» gacha" delay={120} />
        <KpiCard icon={UserCheck} tone={s.responsible_registered === s.responsible_total ? 'emerald' : 'violet'} label="Botda tanitilgan"
          value={`${s.responsible_registered} / ${s.responsible_total}`} sub="faqat ular tugmani bosa oladi" delay={160} />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h3 className="text-[17px] font-bold tracking-tight text-slate-900">Mas’ullar ({people.length})</h3>
          <Segmented<PersonFilter>
            size="sm"
            value={personFilter}
            onChange={setPersonFilter}
            options={[['all', 'Hammasi'], ['missed', 'Bog‘lanmaganlari bor'], ['unregistered', 'Botda tanitilmagan']]}
          />
        </div>
        {people.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {people.map((p, i) => <PersonCard key={p.name} p={p} delay={i * 40} />)}
          </div>
        ) : (
          <div className="rx-card"><EmptyNote icon={Users}>Bu filtr bo‘yicha mas’ul yo‘q.</EmptyNote></div>
        )}
      </section>

      <button
        type="button"
        onClick={() => setDetails((v) => !v)}
        className="mx-auto flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        data-testid="bot-details-toggle"
      >
        {details ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        Batafsil: kafedralar, o‘qituvchilar va postlar lentasi
      </button>

      {details && (
        <div className="space-y-4">
          <Panel icon={Users} tone="violet" title="Kafedralar" hint="Eng ko‘p «ochmadi» tepada">
            {data.departments.length ? (
              <SortableTable rows={data.departments} columns={depColumns} initialSort={{ key: 'never', dir: 'desc' }} rowKey={(r) => r.department} />
            ) : <EmptyNote icon={Users}>Davrda post yo‘q.</EmptyNote>}
          </Panel>
          <Panel icon={Users} tone="rose" title="O‘qituvchilar" hint="Bot necha marta xabar bergani">
            {data.teachers.length ? (
              <SortableTable rows={data.teachers} columns={teacherColumns} initialSort={{ key: 'never', dir: 'desc' }} rowKey={(r) => r.teacher} />
            ) : <EmptyNote icon={Users}>Davrda post yo‘q.</EmptyNote>}
          </Panel>
          <Panel
            icon={BellRing}
            title="Postlar lentasi"
            hint="Guruhga ketgan postlar (oxirgilari tepada)"
            actions={
              <Segmented<FeedFilter>
                size="sm"
                value={feedFilter}
                onChange={(v) => { setFeedFilter(v); setFeedLimit(30); }}
                options={[['all', 'Hammasi'], ['never', 'Ochmadi'], ['left', 'Chiqib ketdi'], ['short', '40 daq dan kam'], ['misuse', 'Test/keys yo‘q'], ['uncalled', 'Bog‘lanilmagan'], ['comments', 'Izohli']]}
              />
            }
          >
            {feed.length ? (
              <div className="px-3 py-3 sm:px-4">
                <ul className="grid gap-2 lg:grid-cols-2">{feed.slice(0, feedLimit).map((item) => <FeedCard key={item.id} item={item} />)}</ul>
                {feed.length > feedLimit && (
                  <button
                    type="button"
                    onClick={() => setFeedLimit((n) => n + 30)}
                    className="mx-auto mt-3 flex items-center gap-1 rounded-full bg-slate-100 px-4 py-2 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-200"
                  >
                    <ChevronDown size={14} /> Yana ko‘rsatish ({feed.length - feedLimit})
                  </button>
                )}
              </div>
            ) : <EmptyNote icon={BellRing}>Bu filtr bo‘yicha post yo‘q.</EmptyNote>}
          </Panel>
        </div>
      )}
    </div>
  );
}
