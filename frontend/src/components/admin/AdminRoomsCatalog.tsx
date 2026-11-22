import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Building2, Check, CircleAlert, History, Loader2, Monitor, MonitorOff, Pencil, RefreshCw, RotateCcw, Search, X,
} from 'lucide-react';
import { errorText } from '../../utils/staffSelfApi';
import {
  applyRoomChanges,
  fetchRoomsCatalog,
  relinkMonitor,
  resolveDuplicateMonitor,
  resyncMonitorRooms,
  retireMonitor,
  undoMonitorChange,
  type CatalogHistory,
  type CatalogMonitor,
  type CatalogRoom,
  type RoomsCatalog,
} from '../../utils/monitorRoomsApi';

/**
 * «Monitorli xonalar» (2026-11-16, 3-variant). Foydalanuvchi: "uzun ro'yxat emas, zo'r tushunarli qiling;
 * konfliktlar ko'p bo'ladi — har tomonlama o'ylashimiz kerak".
 *
 * * Chapda binolar, o'ngda tanlangan binoning xonalari QAVATLAR bo'yicha plitka: yashil — monitor bor,
 *   sariq hoshiya — monitor yo'q, lekin klinik darsi bor (monitor kerak bo'lishi mumkin), qizil — muammo.
 * * O'zgartirish faqat «Tahrirlash» rejimida: plitkalar belgilanadi, pastda o'zgarishlar yig'iladi,
 *   «Ko'rib chiqish» oynasida har biri ta'siri bilan ko'rinadi va bitta tasdiq bilan saqlanadi —
 *   tasodifiy bosish hech narsani buzmaydi.
 * * «Muammolar» — takror monitorlar, HEMIS'da xonasi yo'q monitorlar, bir necha xonaga bog'langan
 *   monitorlar; har biriga tuzatish tugmasi. «Tarix» — kim, qachon, nima qildi; qaytarish mumkin.
 */

type Tab = 'buildings' | 'problems' | 'history';
type RoomFilter = 'all' | 'monitor' | 'need';

const ACTION: Record<CatalogHistory['action'], string> = {
  on: 'Monitor qo‘shildi',
  off: 'Monitor olib tashlandi',
  relink: 'Boshqa xonaga bog‘landi',
  dedupe: 'Takror tuzatildi',
  retire: 'Xonasiz monitor olib tashlandi',
  undo: 'Qaytarildi',
};

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function Kpi({ label, value, hint, tone, onClick }: { label: string; value: number; hint?: string; tone: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={`flex-1 rounded-2xl px-4 py-3 text-left ring-1 transition disabled:cursor-default ${tone} ${onClick ? 'hover:shadow-md' : ''}`}>
      <span className="block text-[13px] font-medium opacity-80">{label}</span>
      <span className="block text-[28px] font-bold leading-tight tabular-nums">{value}</span>
      {hint && <span className="block text-[12px] opacity-70">{hint}</span>}
    </button>
  );
}

function Tile({ r, pending, editing, showCode, onClick }: { r: CatalogRoom; pending?: boolean; editing: boolean; showCode?: boolean; onClick: () => void }) {
  const on = pending === undefined ? !!r.monitor : pending;
  const changed = pending !== undefined;
  const need = !on && r.scope_lessons > 0;
  const tone = r.conflict ? 'bg-rose-50 ring-2 ring-rose-400'
    : on ? 'bg-emerald-500 text-white ring-1 ring-emerald-600'
      : need ? 'border-2 border-dashed border-amber-400 bg-amber-50/40' : 'bg-white ring-1 ring-slate-200';
  return (
    <button type="button" onClick={onClick}
      title={`${r.name}${r.type ? ` · ${r.type}` : ''}${r.volume ? ` · ${r.volume} o‘rin` : ''}\n${r.lessons} amaliy dars, ${r.scope_lessons} tasi nazoratda (2 hafta)${r.monitor ? `\n${r.monitor.monitor_id}` : ''}`}
      className={`relative flex h-[96px] w-full flex-col justify-between rounded-xl p-2 text-left transition hover:-translate-y-0.5 hover:shadow-md ${tone} ${changed ? 'outline outline-2 outline-offset-2 outline-indigo-500' : ''} ${editing ? 'cursor-pointer' : ''}`}>
      <span className="flex items-start justify-between gap-1">
        <span className={`line-clamp-2 break-words font-bold leading-tight ${r.label.length > 14 ? 'text-[12.5px]' : 'text-[15px]'} ${on ? '' : 'text-slate-900'}`}>{r.label}</span>
        {r.conflict ? <CircleAlert size={15} className="shrink-0 text-rose-600" />
          : on ? <Monitor size={15} className="shrink-0 opacity-90" /> : null}
      </span>
      <span className={`truncate text-[11px] ${on ? 'text-emerald-50' : 'text-slate-500'}`}>
        {[r.type, r.volume ? `${r.volume} o‘rin` : ''].filter(Boolean).join(' · ')}{showCode ? ` · #${r.code}` : ''}
      </span>
      <span className={`text-[11.5px] font-semibold tabular-nums ${on ? 'text-white' : need ? 'text-amber-700' : 'text-slate-300'}`}>
        {r.scope_lessons ? `${r.scope_lessons} nazoratda` : r.lessons ? `${r.lessons} dars` : 'dars yo‘q'}
      </span>
      {changed && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-indigo-600 px-1.5 py-px text-[10.5px] font-bold text-white shadow">
          {pending ? '+ qo‘shiladi' : '− olinadi'}
        </span>
      )}
    </button>
  );
}

function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3" onClick={onClose}>
      <div className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-bold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2" aria-label="Yopish"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RoomPicker({ rooms, onPick }: { rooms: CatalogRoom[]; onPick: (r: CatalogRoom) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle.length < 1 ? [] : rooms.filter((r) => `${r.name} ${r.building}`.toLowerCase().includes(needle)).slice(0, 40);
  return (
    <div>
      <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
        <Search size={15} className="text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Xona yoki bino nomi" className="min-w-0 flex-1 text-[14px] outline-none" />
      </label>
      <ul className="mt-2 max-h-[45vh] divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-100">
        {shown.map((r) => (
          <li key={r.code}>
            <button type="button" disabled={!!r.monitor} onClick={() => onPick(r)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50">
              <b className="text-slate-900">{r.name}</b><span className="text-slate-500">· {r.building}</span>
              {r.monitor && <span className="ml-auto text-[12px] text-rose-600">monitor bor: {r.monitor.monitor_id}</span>}
            </button>
          </li>
        ))}
        {needle && !shown.length && <li className="px-3 py-6 text-center text-[14px] text-slate-400">Topilmadi</li>}
      </ul>
    </div>
  );
}

export default function AdminRoomsCatalog() {
  const [data, setData] = useState<RoomsCatalog | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('buildings');
  const [building, setBuilding] = useState('');
  const [bq, setBq] = useState('');
  const [rq, setRq] = useState('');
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState(false);
  const [detail, setDetail] = useState<CatalogRoom | null>(null);
  const [relinkFor, setRelinkFor] = useState<CatalogMonitor | null>(null);
  const [keep, setKeep] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      setData(await fetchRoomsCatalog());
      setError('');
    } catch (e) {
      setError(errorText(e, 'Xonalar ro‘yxatini yuklab bo‘lmadi.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      await fn();
      setMsg(done);
      await load();
    } catch (e) {
      setError(errorText(e, 'Saqlab bo‘lmadi.'));
    } finally {
      setBusy(false);
    }
  };

  const rooms = data?.rooms || [];
  const byCode = useMemo(() => new Map(rooms.map((r) => [r.code, r])), [rooms]);
  const buildings = useMemo(() => {
    const m = new Map<string, { name: string; ours: boolean; rooms: number; monitors: number; need: number; conflicts: number; scope: number }>();
    for (const r of rooms) {
      const b = m.get(r.building) || { name: r.building, ours: false, rooms: 0, monitors: 0, need: 0, conflicts: 0, scope: 0 };
      b.rooms += 1;
      b.ours ||= !!r.building_key;
      if (r.monitor) b.monitors += 1;
      if (!r.monitor && r.scope_lessons) b.need += 1;
      if (r.conflict) b.conflicts += 1;
      b.scope += r.scope_lessons;
      m.set(r.building, b);
    }
    return [...m.values()].sort((a, b) => Number(b.ours) - Number(a.ours) || b.monitors - a.monitors || b.scope - a.scope || a.name.localeCompare(b.name));
  }, [rooms]);
  useEffect(() => {
    if (!building && buildings.length) setBuilding(buildings[0].name);
  }, [building, buildings]);

  const floors = useMemo(() => {
    const needle = rq.trim().toLowerCase();
    const list = rooms.filter((r) => r.building === building
      && (filter !== 'monitor' || r.monitor) && (filter !== 'need' || (!r.monitor && r.scope_lessons))
      && (!needle || `${r.name} ${r.monitor?.monitor_id || ''}`.toLowerCase().includes(needle)));
    const by = new Map<string, CatalogRoom[]>();
    for (const r of list) by.set(r.floor || '', [...(by.get(r.floor || '') || []), r]);
    // HEMIS bir binoda bir xil nomli bir necha xona yozgan ("* /um-j" ×7) — ularni kod bilan farqlaymiz.
    return [...by.entries()]
      .map(([f, l]) => [f, l.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))] as const)
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  }, [rooms, building, filter, rq]);

  const sameName = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rooms) if (r.building === building) c.set(r.name, (c.get(r.name) || 0) + 1);
    return new Set([...c.entries()].filter(([, n]) => n > 1).map(([n]) => n));
  }, [rooms, building]);
  const conflicts = data?.conflicts;
  const problemCount = (conflicts?.duplicates.length || 0) + (conflicts?.unmatched.length || 0) + (conflicts?.shared.length || 0);
  const changes = Object.entries(pending).map(([code, on]) => ({ code, on, room: byCode.get(code) })).filter((c) => c.room);
  const adds = changes.filter((c) => c.on).length;

  const clickTile = (r: CatalogRoom) => {
    if (!editing) { setDetail(r); return; }
    setPending((p) => {
      const next = { ...p };
      const want = !(r.code in p ? p[r.code] : !!r.monitor);
      if (want === !!r.monitor) delete next[r.code]; else next[r.code] = want;
      return next;
    });
  };

  if (!data) {
    return error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-rose-700">{error}</p>
      : <p className="flex items-center gap-2 p-4 text-slate-500"><Loader2 size={16} className="animate-spin" /> HEMIS xonalari yuklanmoqda…</p>;
  }
  const withMonitor = rooms.filter((r) => r.monitor);
  const need = rooms.filter((r) => !r.monitor && r.scope_lessons);
  const cur = buildings.find((b) => b.name === building);
  const roomHistory = (code: string) => data.history.filter((h) => h.code === code);

  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Kpi label="Faol HEMIS xonalari" value={rooms.length} hint={`${buildings.length} ta bino`} tone="bg-white text-slate-900 ring-slate-200" />
        <Kpi label="Monitor bor" value={withMonitor.length} hint={`${withMonitor.reduce((n, r) => n + r.scope_lessons, 0)} nazoratdagi dars (2 hafta)`} tone="bg-emerald-50 text-emerald-900 ring-emerald-200" />
        <Kpi label="Monitorsiz, lekin klinik darsi bor" value={need.length} hint={`${need.reduce((n, r) => n + r.scope_lessons, 0)} dars nazoratdan tashqarida`} tone="bg-amber-50 text-amber-900 ring-amber-200" />
        <Kpi label="Muammolar" value={problemCount} hint={problemCount ? 'tuzatish uchun bosing' : 'ziddiyat yo‘q'}
          tone={problemCount ? 'bg-rose-50 text-rose-900 ring-rose-200' : 'bg-white text-slate-500 ring-slate-200'}
          onClick={problemCount ? () => setTab('problems') : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-xl bg-slate-100 p-0.5">
          {([['buildings', 'Binolar va xonalar'], ['problems', `Muammolar${problemCount ? ` (${problemCount})` : ''}`], ['history', 'Tarix']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`rounded-lg px-3.5 py-1.5 text-[14px] font-semibold ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'} ${k === 'problems' && problemCount ? 'text-rose-700' : ''}`}>
              {label}
            </button>
          ))}
        </span>
        <button type="button" disabled={data.sync.running} onClick={() => void act(resyncMonitorRooms, 'HEMIS bilan solishtirish boshlandi — 1–2 daqiqa.')}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13.5px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw size={15} className={data.sync.running ? 'animate-spin' : ''} /> {data.sync.running ? 'Solishtirilmoqda…' : 'HEMIS bilan solishtirish'}
        </button>
      </div>
      {msg && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-[14px] text-emerald-800">{msg}</p>}
      {error && <p className="rounded-xl bg-rose-50 px-4 py-2 text-[14px] text-rose-700">{error}</p>}

      {tab === 'buildings' && (
        <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="rounded-2xl bg-white p-2 ring-1 ring-slate-200 lg:sticky lg:top-3 lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
            <label className="mb-1 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input value={bq} onChange={(e) => setBq(e.target.value)} placeholder="Bino" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
            </label>
            <ul>
              {buildings.filter((b) => !bq.trim() || b.name.toLowerCase().includes(bq.trim().toLowerCase())).map((b) => (
                <li key={b.name}>
                  <button type="button" onClick={() => { setBuilding(b.name); setRq(''); }}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition ${b.name === building ? 'bg-sky-50 ring-1 ring-sky-200' : 'hover:bg-slate-50'}`}>
                    <Building2 size={15} className={b.ours ? 'shrink-0 text-sky-600' : 'shrink-0 text-slate-300'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-slate-800">{b.name || 'Binosi ko‘rsatilmagan'}</span>
                      <span className="block text-[11.5px] text-slate-500">{b.rooms} xona · <b className={b.monitors ? 'text-emerald-700' : ''}>{b.monitors} monitor</b></span>
                    </span>
                    {b.conflicts > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="Muammo bor" />}
                    {b.need > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800" title="Monitorsiz, klinik darsi bor xonalar">{b.need}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="min-w-0 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-[18px] font-bold text-slate-900">{building}
                {cur && <span className="ml-2 text-[13px] font-normal text-slate-500">{cur.rooms} xona · {cur.monitors} monitor</span>}
              </h3>
              {editing ? (
                <button type="button" onClick={() => { setEditing(false); setPending({}); }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-[13.5px] font-semibold text-slate-700">
                  <X size={15} /> Tahrirlashdan chiqish
                </button>
              ) : (
                <button type="button" onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-sky-700">
                  <Pencil size={15} /> Tahrirlash
                </button>
              )}
            </div>
            {editing && (
              <p className="mt-2 rounded-xl bg-indigo-50 px-3 py-2 text-[13.5px] text-indigo-900">
                Monitor qo‘yilgan yoki olingan xonalarni bosing — belgilanadi. Hech narsa darhol saqlanmaydi: pastdagi «Ko‘rib chiqish» orqali tasdiqlaysiz.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-xl bg-slate-100 p-0.5">
                {([['all', 'Hamma xonalar'], ['monitor', 'Monitorli'], ['need', 'Monitorsiz, klinik darsi bor']] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)}
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${filter === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{label}</button>
                ))}
              </span>
              <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5">
                <Search size={14} className="text-slate-400" />
                <input value={rq} onChange={(e) => setRq(e.target.value)} placeholder="Xona yoki MON ID" className="min-w-0 flex-1 text-[13.5px] outline-none" />
              </label>
              <span className="flex flex-wrap items-center gap-3 text-[12px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-500" /> monitor bor</span>
                <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-dashed border-amber-400" /> monitorsiz, klinik darsi bor</span>
                <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-rose-50 ring-2 ring-rose-400" /> muammo</span>
              </span>
            </div>
            <div className="mt-3 space-y-4">
              {floors.map(([floor, list]) => (
                <div key={floor || 'other'}>
                  <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-400">{floor || (floors.length > 1 ? 'Boshqa xonalar' : 'Xonalar')} · {list.length}</p>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
                    {list.map((r) => <Tile key={r.code} r={r} editing={editing} pending={pending[r.code]} showCode={sameName.has(r.name)} onClick={() => clickTile(r)} />)}
                  </div>
                </div>
              ))}
              {!floors.length && <p className="py-10 text-center text-[14px] text-slate-400">Bu filtr bo‘yicha xona yo‘q</p>}
            </div>
          </section>
        </div>
      )}

      {tab === 'problems' && conflicts && (
        <div className="space-y-3">
          {problemCount === 0 && <p className="rounded-2xl bg-emerald-50 px-4 py-6 text-center text-[15px] text-emerald-800 ring-1 ring-emerald-200"><Check className="mr-1 inline" size={18} /> Ziddiyat yo‘q — har xonada ko‘pi bilan bitta monitor, hamma monitor HEMIS xonasiga bog‘langan.</p>}
          {conflicts.duplicates.length > 0 && (
            <section className="rounded-2xl bg-white p-4 ring-1 ring-rose-200">
              <h3 className="text-[16px] font-bold text-rose-800">Bitta xonada bir necha monitor yozuvi ({conflicts.duplicates.length})</h3>
              <p className="mb-2 text-[13px] text-slate-600">Darslar faqat bitta monitorga yozilishi kerak. Qaysi biri qolishini tanlang (odatda darslari ko‘pi) — qolganlari shu xonadan ajratiladi, o‘tgan hisobot o‘zgarmaydi.</p>
              <ul className="space-y-2">
                {conflicts.duplicates.map((d) => {
                  const best = [...d.monitors].sort((a, b) => b.lessons_total - a.lessons_total)[0];
                  const chosen = keep[d.code] ?? best.id;
                  return (
                    <li key={d.code} className="rounded-xl bg-rose-50/50 p-3 ring-1 ring-rose-100">
                      <p className="text-[14px] font-semibold text-slate-900">{d.name} <span className="font-normal text-slate-500">· {d.building}</span></p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {d.monitors.map((m) => (
                          <label key={m.id} className={`flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] ring-1 ${chosen === m.id ? 'ring-emerald-400' : 'ring-slate-200'}`}>
                            <input type="radio" name={`keep-${d.code}`} checked={chosen === m.id} onChange={() => setKeep((k) => ({ ...k, [d.code]: m.id }))} className="accent-emerald-600" />
                            <span><b className="font-mono">{m.monitor_id}</b> · {m.room_full}<span className="block text-[11.5px] text-slate-500">{m.lessons_total} dars yozilgan{m.active_from ? ` · ${m.active_from} dan` : ''}</span></span>
                          </label>
                        ))}
                        <button type="button" disabled={busy}
                          onClick={() => void act(() => resolveDuplicateMonitor(d.code, chosen), `${d.name} — bitta monitor qoldi.`)}
                          className="self-center rounded-xl bg-rose-600 px-3.5 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50">Tanlanganini qoldirish</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {conflicts.unmatched.length > 0 && (
            <section className="rounded-2xl bg-white p-4 ring-1 ring-amber-200">
              <h3 className="text-[16px] font-bold text-amber-900">HEMIS’da faol xonasi topilmagan monitorlar ({conflicts.unmatched.length})</h3>
              <p className="mb-2 text-[13px] text-slate-600">Bu monitorlardagi darslar nazoratga tushmaydi. To‘g‘ri xonani tanlang (MON ID saqlanadi) yoki monitor endi yo‘q bo‘lsa — olib tashlang.</p>
              <ul className="space-y-2">
                {conflicts.unmatched.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50/60 px-3 py-2 ring-1 ring-amber-100">
                    <b className="font-mono text-[13px]">{m.monitor_id}</b>
                    <span className="text-[14px] text-slate-900">{m.room_full}</span>
                    <span className="text-[12.5px] text-slate-500">· {m.department} · {m.lessons_total} dars yozilgan</span>
                    <span className="ml-auto flex gap-2">
                      <button type="button" onClick={() => setRelinkFor(m)} className="rounded-xl bg-sky-600 px-3 py-1.5 text-[13px] font-semibold text-white">Xonani tanlash</button>
                      <button type="button" disabled={busy}
                        onClick={() => { if (window.confirm(`${m.monitor_id} (${m.room_full}) olib tashlansinmi?`)) void act(() => retireMonitor(m.id), `${m.monitor_id} olib tashlandi.`); }}
                        className="rounded-xl bg-white px-3 py-1.5 text-[13px] font-semibold text-rose-700 ring-1 ring-rose-200">Olib tashlash</button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {conflicts.shared.length > 0 && (
            <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <h3 className="text-[16px] font-bold text-slate-900">Bitta monitor bir necha HEMIS xonasiga bog‘langan ({conflicts.shared.length})</h3>
              <p className="mb-2 text-[13px] text-slate-600">HEMIS bitta xonani turli nomlar bilan yozgan bo‘lishi mumkin — unda to‘g‘ri. Agar monitor faqat bitta xonada bo‘lsa, ortiqchasini ajrating.</p>
              <ul className="space-y-2">
                {conflicts.shared.map((m) => (
                  <li key={m.id} className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                    <p className="text-[14px]"><b className="font-mono text-[13px]">{m.monitor_id}</b> · {m.room_full}</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {m.rooms.map((r) => (
                        <span key={r.code} className="inline-flex items-center gap-2 rounded-lg bg-white px-2.5 py-1 text-[13px] ring-1 ring-slate-200">
                          {r.name} <span className="text-slate-400">· {r.building}</span>
                          <button type="button" disabled={busy} title="Bu xonani monitordan ajratish"
                            onClick={() => { if (window.confirm(`${r.name} — ${m.monitor_id} dan ajratilsinmi?`)) void act(() => applyRoomChanges([{ code: r.code, on: false }]), `${r.name} ajratildi.`); }}
                            className="text-rose-600 hover:text-rose-800"><X size={14} /></button>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === 'history' && (
        <section className="overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
          {data.history.length === 0 ? <p className="px-4 py-10 text-center text-slate-500"><History className="mr-1 inline" size={16} /> Hali o‘zgarish yo‘q.</p> : (
            <table className="w-full text-[13.5px]">
              <thead className="bg-slate-50 text-left text-[12px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2">Vaqt</th><th className="px-3 py-2">Kim</th><th className="px-3 py-2">Nima</th><th className="px-3 py-2">Xona</th><th className="px-3 py-2">Monitor</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.history.map((h) => (
                  <tr key={h.id} className={h.undone ? 'text-slate-400 line-through' : ''}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtTime(h.at)}</td>
                    <td className="px-3 py-2">{h.by}</td>
                    <td className="px-3 py-2">{ACTION[h.action] || h.action}<span className="block text-[12px] text-slate-500">{h.detail}</span></td>
                    <td className="px-3 py-2">{h.room}</td>
                    <td className="px-3 py-2 font-mono text-[12.5px]">{h.monitor_id}</td>
                    <td className="px-3 py-2 text-right">
                      {(h.action === 'on' || h.action === 'off') && !h.undone && (
                        <button type="button" disabled={busy} onClick={() => void act(() => undoMonitorChange(h.id), 'O‘zgarish qaytarildi.')}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-200">
                          <RotateCcw size={13} /> Qaytarish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {editing && changes.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-2xl">
            <span className="text-[14px]"><b>{changes.length}</b> ta o‘zgarish: <b className="text-emerald-300">+{adds}</b> monitor qo‘shiladi, <b className="text-rose-300">−{changes.length - adds}</b> olinadi</span>
            <button type="button" onClick={() => setPending({})} className="rounded-xl bg-white/10 px-3 py-1.5 text-[13.5px] font-semibold hover:bg-white/20">Bekor qilish</button>
            <button type="button" onClick={() => setReview(true)} className="rounded-xl bg-emerald-500 px-3.5 py-1.5 text-[13.5px] font-semibold hover:bg-emerald-400">Ko‘rib chiqish va saqlash</button>
          </div>
        </div>
      )}

      {review && (
        <Modal title="O‘zgarishlarni tasdiqlang" onClose={() => setReview(false)} wide>
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {changes.map(({ code, on, room }) => room && (
              <li key={code} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[14px]">
                {on ? <Monitor size={16} className="text-emerald-600" /> : <MonitorOff size={16} className="text-rose-600" />}
                <b>{room.name}</b><span className="text-slate-500">· {room.building}</span>
                <span className={`ml-auto text-[13px] ${on ? 'text-emerald-700' : room.scope_lessons ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
                  {on ? `monitor qo‘shiladi — ${room.scope_lessons} dars nazoratga kiradi`
                    : room.scope_lessons ? `monitor olinadi — ${room.scope_lessons} dars nazoratdan chiqadi!` : 'monitor olinadi'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-slate-500">Qo‘shilgan monitor bugundan hisobga kiradi; olingani o‘tgan hisobotlarni o‘zgartirmaydi. Har o‘zgarish «Tarix»ga yoziladi va qaytarilishi mumkin.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setReview(false)} className="rounded-xl bg-slate-100 px-4 py-2 text-[14px] font-semibold">Orqaga</button>
            <button type="button" disabled={busy}
              onClick={() => void act(async () => {
                const res = await applyRoomChanges(changes.map(({ code, on }) => ({ code, on })));
                if (res.errors?.length) throw new Error(res.errors.map((e) => e.error).join('; '));
                setPending({});
                setReview(false);
                setEditing(false);
              }, `${changes.length} ta o‘zgarish saqlandi. HEMIS darslari 20 soniyadan keyin qayta solishtiriladi.`)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Tasdiqlash
            </button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={<>{detail.name} <span className="text-[14px] font-normal text-slate-500">· {detail.building}</span></>} onClose={() => setDetail(null)}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 p-2"><p className="text-[22px] font-bold">{detail.lessons}</p><p className="text-[12px] text-slate-500">amaliy dars (2 hafta)</p></div>
            <div className="rounded-xl bg-emerald-50 p-2"><p className="text-[22px] font-bold text-emerald-700">{detail.scope_lessons}</p><p className="text-[12px] text-slate-500">nazoratda (klinik)</p></div>
            <div className="rounded-xl bg-slate-50 p-2"><p className="text-[22px] font-bold">{detail.scope_teachers}</p><p className="text-[12px] text-slate-500">o‘qituvchi</p></div>
          </div>
          <dl className="mt-3 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 text-[14px]">
            <dt className="text-slate-500">Monitor</dt>
            <dd>{detail.monitor ? <><b className="font-mono">{detail.monitor.monitor_id}</b>{detail.monitor.active_from ? ` · ${detail.monitor.active_from} dan` : ''} · {detail.monitor.lessons_total} dars yozilgan</> : <span className="text-slate-400">yo‘q</span>}</dd>
            <dt className="text-slate-500">Xona turi</dt><dd>{[detail.type, detail.volume ? `${detail.volume} o‘rin` : ''].filter(Boolean).join(' · ') || '—'}</dd>
            <dt className="text-slate-500">Kafedralar</dt><dd>{detail.departments.join('; ') || '—'}</dd>
            <dt className="text-slate-500">Klinik fanlar</dt><dd>{detail.subjects.join('; ') || '—'}</dd>
            <dt className="text-slate-500">HEMIS kodi</dt><dd className="font-mono text-[13px] text-slate-500">{detail.code}</dd>
          </dl>
          {detail.conflict && <p className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13.5px] text-rose-800"><AlertTriangle size={15} /> Bu xonada bir necha monitor yozuvi bor — «Muammolar»da tuzating.</p>}
          {roomHistory(detail.code).length > 0 && (
            <div className="mt-3">
              <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">Tarix</p>
              <ul className="mt-1 space-y-1 text-[13px] text-slate-600">
                {roomHistory(detail.code).map((h) => <li key={h.id}>{fmtTime(h.at)} · {h.by} · {ACTION[h.action] || h.action} {h.monitor_id}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={() => { setEditing(true); setPending((p) => ({ ...p, [detail.code]: !detail.monitor })); setDetail(null); }}
              className={`rounded-xl px-4 py-2 text-[14px] font-semibold ${detail.monitor ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' : 'bg-emerald-600 text-white'}`}>
              {detail.monitor ? 'Monitorni olib tashlash…' : 'Monitor qo‘shish…'}
            </button>
          </div>
        </Modal>
      )}

      {relinkFor && (
        <Modal title={`${relinkFor.monitor_id} — qaysi xonada turibdi?`} onClose={() => setRelinkFor(null)}>
          <p className="mb-2 text-[13.5px] text-slate-600">Eski nomi: <b>{relinkFor.room_full}</b>. HEMIS’dagi faol xonani tanlang (monitori bor xonani tanlab bo‘lmaydi).</p>
          <RoomPicker rooms={rooms} onPick={(r) => { const m = relinkFor; setRelinkFor(null); void act(() => relinkMonitor(m.id, r.code), `${m.monitor_id} → ${r.name} (${r.building}).`); }} />
        </Modal>
      )}
    </div>
  );
}
