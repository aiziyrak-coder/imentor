import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2, MapPin, MapPinned, RefreshCw, X } from 'lucide-react';
import { errorText } from '../../utils/staffSelfApi';
import { fetchOffsitePhotoUrl, fetchOffsiteReport, type OffsiteItem, type OffsiteReport } from '../../utils/offsiteLessonApi';

/**
 * «Boshqa joyda darslar» (2026-11-12) — o'qituvchi dars vaqtida telefondan "Darsni boshqa joyda
 * o'tyapman" deb rasm bilan qayd etgan darslar. Tasdiqsiz kuchga kiradi: bu darslar rektor
 * hisobotida qizil bo'lmaydi. Bu sahifa — alohida hisobot: kim, qachon, qayerda, nega, rasm va joylashuv.
 */
function iso(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

function shortDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : value;
}

const RANGES = [
  { id: 'today', label: 'Bugun', days: 0 },
  { id: 'week', label: '7 kun', days: 6 },
  { id: 'month', label: '30 kun', days: 29 },
] as const;

export default function AdminOffsiteLessons() {
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('week');
  const [data, setData] = useState<OffsiteReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ item: OffsiteItem; url: string } | null>(null);
  const [teacher, setTeacher] = useState<string | null>(null);

  const load = useCallback(async () => {
    const days = RANGES.find((r) => r.id === range)?.days ?? 6;
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    try {
      setData(await fetchOffsiteReport(iso(start), iso(end)));
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Hisobotni yuklab bo‘lmadi.'));
    }
  }, [range]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const showPhoto = async (item: OffsiteItem) => {
    try {
      setPhoto({ item, url: await fetchOffsitePhotoUrl(item.id) });
    } catch (err) {
      setError(errorText(err, 'Rasmni ochib bo‘lmadi.'));
    }
  };

  const items = (data?.items || []).filter((x) => !teacher || x.owner_key === teacher);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <MapPinned size={22} className="text-amber-600" />
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">Boshqa joyda o‘tilgan darslar</h1>
          <p className="text-[13px] text-slate-500">
            O‘qituvchi dars vaqtida telefondan rasm bilan qayd etgan — bu darslar rektor hisobotida qizil bo‘lmaydi.
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
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition ${
              range === r.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-900/10 hover:bg-slate-50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-[13.5px] text-rose-700 ring-1 ring-rose-200">{error}</div>}
      {data === null && !error && (
        <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={16} className="animate-spin" /> Yuklanmoqda…</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
              <p className="text-[12.5px] text-slate-500">Darslar</p>
              <p className="text-[24px] font-semibold text-slate-900" data-testid="offsite-total">{data.total}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
              <p className="text-[12.5px] text-slate-500">O‘qituvchilar</p>
              <p className="text-[24px] font-semibold text-slate-900">{data.teachers_count}</p>
            </div>
            <div className="col-span-2 rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
              <p className="mb-1 text-[12.5px] text-slate-500">Sabablar</p>
              {data.by_reason.length === 0 && <p className="text-[13px] text-slate-400">—</p>}
              {data.by_reason.map((r) => (
                <p key={r.reason} className="flex justify-between text-[13.5px] text-slate-700">
                  <span>{r.label}</span>
                  <b>{r.count}</b>
                </p>
              ))}
            </div>
          </div>

          {data.teachers.length > 0 && (
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
              <p className="mb-2 text-[13px] font-medium text-slate-700">O‘qituvchilar kesimida</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTeacher(null)}
                  className={`rounded-full px-3 py-1 text-[12.5px] ring-1 ${teacher === null ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-900/10'}`}
                >
                  Hammasi
                </button>
                {data.teachers.map((t) => (
                  <button
                    key={t.owner_key}
                    type="button"
                    title={`${t.department}\n${Object.entries(t.reasons).map(([k, v]) => `${k}: ${v}`).join('\n')}`}
                    onClick={() => setTeacher(t.owner_key === teacher ? null : t.owner_key)}
                    className={`rounded-full px-3 py-1 text-[12.5px] ring-1 ${teacher === t.owner_key ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-900/10'}`}
                  >
                    {t.name || t.owner_key} · {t.count}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 && <p className="text-[13.5px] text-slate-500">Bu davrda qayd yo‘q.</p>}
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.07]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[15px] font-semibold text-slate-900">{item.name || item.owner_key}</span>
                  <span className="text-[13px] text-slate-500">{item.department}</span>
                  <span className="ml-auto rounded-full bg-amber-50 px-2.5 py-0.5 text-[12px] font-semibold text-amber-800 ring-1 ring-amber-200">
                    {item.reason_label}
                  </span>
                </div>
                <p className="mt-1.5 text-[13.5px] text-slate-700">
                  {shortDate(item.date)} · {item.para}-para ({item.start_time}–{item.end_time}) · {item.subject_name}
                  {item.group_name ? `, ${item.group_name}` : ''}
                </p>
                <p className="text-[12.5px] text-slate-500">
                  Jadvalda: {item.scheduled_room || '—'}
                  {item.created_at && ` · qayd: ${new Date(item.created_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}`}
                </p>
                {item.note && <p className="mt-1.5 text-[13px] text-slate-600">{item.note}</p>}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {item.has_photo && (
                    <button
                      type="button"
                      onClick={() => void showPhoto(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-200"
                    >
                      <ImageIcon size={15} /> Rasm
                    </button>
                  )}
                  {item.lat != null && item.lon != null && (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}#map=18/${item.lat}/${item.lon}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-200"
                    >
                      <MapPin size={15} /> Joylashuv{item.accuracy_m ? ` (±${Math.round(item.accuracy_m)} m)` : ''}
                    </a>
                  )}
                  {item.lat == null && <span className="text-[12.5px] text-slate-400">joylashuv berilmagan</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {photo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPhoto(null)}>
          <div className="relative max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <img src={photo.url} alt="" className="max-h-[85vh] rounded-xl object-contain" />
            <p className="mt-2 text-center text-[13px] text-white">
              {photo.item.name} · {shortDate(photo.item.date)} · {photo.item.para}-para
            </p>
            <button
              type="button"
              aria-label="Yopish"
              onClick={() => setPhoto(null)}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
