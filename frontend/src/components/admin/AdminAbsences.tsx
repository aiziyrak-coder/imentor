import { useCallback, useEffect, useState } from 'react';
import { Check, FileText, HeartPulse, Loader2, RefreshCw, X } from 'lucide-react';
import {
  decideAbsence,
  errorText,
  fetchAdminAbsences,
  openAbsenceDocument,
  type Absence,
  type AbsenceStatus,
} from '../../utils/staffSelfApi';

/**
 * Kasallik varaqasi, ta'til, xizmat safari arizalari (2026-10-28). O'qituvchi yuboradi,
 * admin hujjatni ko'rib tasdiqlaydi — tasdiqlangan kunlardagi o'tilmagan darslar rektor
 * hisobotida kulrang "kasallik varaqasida" bo'ladi va foizga kirmaydi.
 */
const FILTERS: Array<{ id: AbsenceStatus | 'all'; label: string }> = [
  { id: 'pending', label: 'Ko‘rib chiqilmagan' },
  { id: 'approved', label: 'Tasdiqlangan' },
  { id: 'rejected', label: 'Rad etilgan' },
  { id: 'all', label: 'Hammasi' },
];

const STATUS: Record<AbsenceStatus, [string, string]> = {
  pending: ['bg-amber-50 text-amber-800 ring-amber-200', 'Ko‘rib chiqilmoqda'],
  approved: ['bg-emerald-50 text-emerald-700 ring-emerald-200', 'Tasdiqlandi'],
  rejected: ['bg-rose-50 text-rose-700 ring-rose-200', 'Rad etildi'],
};

function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export default function AdminAbsences() {
  const [filter, setFilter] = useState<AbsenceStatus | 'all'>('pending');
  const [items, setItems] = useState<Absence[] | null>(null);
  const [counts, setCounts] = useState<Record<AbsenceStatus, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<{ id: number; note: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAdminAbsences(filter);
      setItems(data.items);
      setCounts(data.counts);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Arizalarni yuklab bo‘lmadi.'));
    }
  }, [filter]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const decide = async (item: Absence, approve: boolean, note = '') => {
    setBusyId(item.id);
    try {
      await decideAbsence(item.id, approve, note);
      setRejecting(null);
      await load();
    } catch (err) {
      setError(errorText(err, 'Saqlab bo‘lmadi.'));
    } finally {
      setBusyId(null);
    }
  };

  const showDoc = async (item: Absence) => {
    try {
      await openAbsenceDocument(item.id, 'admin');
    } catch (err) {
      setError(errorText(err, 'Hujjatni ochib bo‘lmadi.'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-1 sm:p-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
          <HeartPulse size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-tight text-slate-900">Kasallik varaqasi va ta’til</h1>
          <p className="text-[13px] text-slate-500">
            Tasdiqlangan kunlardagi o‘tilmagan darslar rektor hisobotida kulrang bo‘ladi va foizga kirmaydi.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3 text-[13px] font-medium text-slate-700 ring-1 ring-slate-900/10 hover:bg-slate-50"
        >
          <RefreshCw size={15} /> Yangilash
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition ${
              filter === f.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-900/10 hover:bg-slate-50'
            }`}
          >
            {f.label}
            {f.id !== 'all' && counts ? ` · ${counts[f.id]}` : ''}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-[13.5px] text-rose-700 ring-1 ring-rose-200">{error}</div>}
      {items === null && !error && (
        <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={16} className="animate-spin" /> Yuklanmoqda…</div>
      )}
      {items && items.length === 0 && <p className="text-[13.5px] text-slate-500">Ariza yo‘q.</p>}

      <ul className="space-y-2.5">
        {(items || []).map((item) => {
          const [tone, label] = STATUS[item.status];
          return (
            <li key={item.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[15px] font-semibold text-slate-900">{item.name || item.owner_key}</span>
                <span className="text-[13px] text-slate-500">{item.department}</span>
                <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${tone}`}>{label}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-slate-700">
                <span className="font-medium">{item.kind_label}</span>
                <span>{shortDate(item.start_date)} – {shortDate(item.end_date)} · {item.days} kun</span>
                {item.created_at && <span className="text-[12.5px] text-slate-400">yuborildi {shortDate(item.created_at)}</span>}
              </div>
              <p className="mt-1.5 text-[13px] text-slate-600">
                O‘rniga dars o‘tadi:{' '}
                <b>{item.substitute ? `${item.substitute.name}${item.substitute.department ? ` (${item.substitute.department})` : ''}` : 'belgilanmagan'}</b>
              </p>
              {item.note && <p className="mt-1.5 text-[13px] text-slate-600">{item.note}</p>}
              {item.decision_note && <p className="mt-1.5 text-[12.5px] text-slate-500">Izoh: {item.decision_note}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {item.has_document && (
                  <button
                    type="button"
                    onClick={() => void showDoc(item)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-[13px] font-medium text-sky-700 ring-1 ring-slate-900/10 hover:bg-sky-50"
                  >
                    <FileText size={15} /> Hujjatni ko‘rish
                  </button>
                )}
                {item.status !== 'approved' && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void decide(item, true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyId === item.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Tasdiqlash
                  </button>
                )}
                {item.status !== 'rejected' && rejecting?.id !== item.id && (
                  <button
                    type="button"
                    onClick={() => setRejecting({ id: item.id, note: '' })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-[13px] font-medium text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                  >
                    <X size={15} /> Rad etish
                  </button>
                )}
              </div>
              {rejecting?.id === item.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    value={rejecting.note}
                    maxLength={255}
                    onChange={(e) => setRejecting({ id: item.id, note: e.target.value })}
                    placeholder="Rad etish sababi (o‘qituvchiga ko‘rinadi)"
                    className="h-9 min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 text-[13.5px] outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    disabled={!rejecting.note.trim() || busyId === item.id}
                    onClick={() => void decide(item, false, rejecting.note.trim())}
                    className="inline-flex h-9 items-center rounded-xl bg-rose-600 px-3.5 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    Rad etish
                  </button>
                  <button type="button" onClick={() => setRejecting(null)} className="h-9 px-2 text-[13px] text-slate-500">
                    Bekor
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
