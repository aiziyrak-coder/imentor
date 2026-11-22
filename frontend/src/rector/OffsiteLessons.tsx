import { useEffect, useState } from 'react';
import { ChevronRight, Image as ImageIcon, MapPin, MapPinned, X } from 'lucide-react';
import {
  fetchRectorOffsite,
  fetchRectorOffsitePhoto,
  type RectorOffsiteItem,
  type RectorOffsiteReport,
  type ReportFilters,
} from './rectorApi';

/**
 * «Boshqa joyda o'tilgan darslar» (2026-11-12): o'qituvchi dars vaqtida telefondan sabab, rasm va izoh
 * bilan qayd etgan darslar. Bu darslar foizga kirmaydi va qizil bo'lmaydi; rektor har qaydning izohini
 * va rasmini shu yerda ko'radi. Dekan — faqat o'z kafedralarini (server cheklaydi).
 */
function shortDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}` : value;
}

export default function OffsiteLessons({ filters }: { filters: ReportFilters }) {
  const [data, setData] = useState<RectorOffsiteReport | null>(null);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<{ item: RectorOffsiteItem; url: string } | null>(null);
  const [photoError, setPhotoError] = useState('');
  /** Yuklanmadi — bo'lim jimgina yo'qolmaydi ("boshqa joyda dars yo'q" degani emas). */
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoadFailed(false);
    fetchRectorOffsite(filters)
      .then((r) => { if (alive) setData(r); })
      .catch(() => {
        if (!alive) return;
        setData(null);
        setLoadFailed(true);
      });
    return () => { alive = false; };
  }, [filters.from, filters.to, filters.refreshKey, retryTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  if (loadFailed) {
    return (
      <section
        role="alert"
        className="rx-card flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"
        data-testid="rector-offsite-error"
      >
        <span className="text-[13px] text-rose-700">
          «Boshqa joyda o‘tilgan darslar»ni yuklab bo‘lmadi.
        </span>
        <button
          type="button"
          onClick={() => setRetryTick((n) => n + 1)}
          className="shrink-0 text-[12.5px] font-semibold text-rose-700 underline underline-offset-2 hover:text-rose-900"
        >
          Qayta urinish
        </button>
      </section>
    );
  }

  if (!data || !data.total) return null;

  const showPhoto = async (item: RectorOffsiteItem) => {
    setPhotoError('');
    try {
      setPhoto({ item, url: await fetchRectorOffsitePhoto(item.id) });
    } catch {
      setPhotoError('Rasmni ochib bo‘lmadi.');
    }
  };

  return (
    <section className="rx-card rx-rise overflow-hidden" data-testid="rector-offsite">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50 sm:px-5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md">
          <MapPinned size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold text-slate-900">Boshqa joyda o‘tilgan darslar</span>
          <span className="block text-[12px] text-slate-500 rx-num">
            {data.teachers_count} o‘qituvchi · {data.total} dars · rasm va izoh bilan
            {data.by_reason.length > 0 && <> · {data.by_reason.map((r) => `${r.label.toLowerCase()} ${r.count}`).join(', ')}</>}
          </span>
        </span>
        <ChevronRight size={18} className={`ml-auto shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <p className="border-t border-slate-100 bg-amber-50/50 px-4 py-2.5 text-[12px] leading-relaxed text-slate-600 sm:px-5">
        O‘qituvchi dars vaqtida telefondan «Darsni boshqa joyda o‘tyapman» deb sabab, rasm va izoh yuborgan.
        Bu darslar qizil hisoblanmaydi va foizga kirmaydi.
      </p>

      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {photoError && <li className="px-4 py-2 text-[12.5px] text-rose-600 sm:px-5">{photoError}</li>}
          {data.items.slice(0, 200).map((item) => (
            <li key={item.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[13.5px] font-semibold text-slate-900">{item.name || item.owner_key}</span>
                <span className="text-[12px] text-slate-500">{item.department}</span>
                <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800 ring-1 ring-amber-200">
                  {item.reason_label}
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-slate-600 rx-num">
                {shortDate(item.date)} · {item.para}-para ({item.start_time}–{item.end_time}) · {item.subject_name}
                {item.group_name ? `, ${item.group_name}` : ''} · jadvalda: {item.scheduled_room || '—'}
              </p>
              {item.note && <p className="mt-1 text-[13px] leading-snug text-slate-800">«{item.note}»</p>}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {item.has_photo && (
                  <button
                    type="button"
                    onClick={() => void showPhoto(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-200"
                  >
                    <ImageIcon size={13} /> Rasm
                  </button>
                )}
                {item.lat != null && item.lon != null && (
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}#map=18/${item.lat}/${item.lon}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-200"
                  >
                    <MapPin size={13} /> Joylashuv
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {photo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPhoto(null)}>
          <div className="relative max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <img src={photo.url} alt="" className="max-h-[80vh] rounded-xl object-contain" />
            <p className="mt-2 text-center text-[13px] text-white">
              {photo.item.name} · {shortDate(photo.item.date)} · {photo.item.para}-para
            </p>
            {photo.item.note && <p className="mt-1 text-center text-[13px] text-white/90">«{photo.item.note}»</p>}
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
    </section>
  );
}
