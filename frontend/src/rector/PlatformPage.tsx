import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import ControlReport from './ControlReport';
import TelegramBotReport from './TelegramBotReport';
import MonitorRoomsReport from './MonitorRoomsReport';
import { fetchPlatforms, type PlatformsReport, type ReportFilters } from './rectorApi';
import './rector.css';

/**
 * Bitta tanlangan platformaning hisoboti — o'z sahifasida.
 *
 * iMentor uchun bu to'liq nazorat hisoboti; qolgan tizimlar uchun ularning
 * o'z ko'rsatkichlari. Hamma tizim bitta sahifaga jamlanmaydi (2026-10-08).
 *
 * iMentor sahifasi — faqat umumiy nazorat hisoboti. Kun bo'yicha, monitor
 * xonalari, dars jadvali va AI tahlil ko'rinishlari 2026-11-15 da olib
 * tashlangan (2026-11-17 da ularning kodi ham o'chirildi).
 */
export default function PlatformPage({
  platform,
  filters,
  onUnauthorized,
  onBack,
  onDepartment,
}: {
  platform: string;
  filters: ReportFilters;
  onUnauthorized: () => void;
  onBack: () => void;
  /** Bosh sahifadagi fakultet/kafedra kesimidan filtr tanlash (2026-11-16). */
  onDepartment?: (value: string) => void;
}) {
  const [data, setData] = useState<PlatformsReport | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchPlatforms(filters)
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (/401|403/.test(String(e))) onUnauthorized();
        else if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [filters, onUnauthorized]);

  const found = data?.platforms.find((p) => p.key === platform);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="ios-press inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-[15px] font-semibold text-indigo-600 shadow-sm ring-1 ring-slate-200"
    >
      <ArrowLeft size={17} />
      Tizimlar
    </button>
  );

  if (platform === 'monitors') {
    return <MonitorRoomsReport onUnauthorized={onUnauthorized} onBack={onBack} />;
  }
  if (platform === 'telegram') {
    return <TelegramBotReport filters={filters} onUnauthorized={onUnauthorized} onBack={onBack} />;
  }

  return (
    <div className="space-y-3">
      {/* Sarlavha qatori faqat iMentor'dan boshqa tizimlarda (rektor, 2026-11-15: "shu joy kerak emas").
          Orqaga qaytish — headerdagi logotip. */}
      {platform !== 'imentor' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {back}
          <h2 className="text-[22px] font-bold tracking-tight text-slate-900 sm:text-[24px]">
            {found?.label || (platform === 'imentor' ? 'Darsga tayyorgarlik (iMentor)' : platform)}
          </h2>
          {found?.link && (
            <a
              href={found.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[14px] font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              Saytni ochish <ExternalLink size={15} />
            </a>
          )}
        </div>
      )}

      {/* iMentor — umumiy nazorat hisoboti (asosiy tanlov headerdagi surmada:
          ustozlar yoki talabalar). */}
      {platform === 'imentor' ? (
        <div className="space-y-3">
          <ControlReport filters={filters} onUnauthorized={onUnauthorized} onDepartment={onDepartment} />
        </div>
      ) : error ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-700 ring-1 ring-rose-200">
          Ma’lumot kelmadi: {error}
        </p>
      ) : !data ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : !found ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-[13px] text-slate-500 ring-1 ring-slate-900/[0.06]">
          Bu tizim hali ulanmagan.
        </p>
      ) : found.cards.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-[13px] text-slate-500 ring-1 ring-slate-900/[0.06]">
          {found.note || 'Ma’lumot yo‘q'}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {found.cards.map((c, i) => (
              <div
                key={c.metric}
                className="rx-card rx-rise relative overflow-hidden px-5 py-4"
                style={{ ['--rx-delay' as string]: `${i * 60}ms` } as React.CSSProperties}
              >
                <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
                <p className="text-[12px] font-semibold text-slate-500">{c.title}</p>
                <p className="mt-1 text-[30px] font-extrabold leading-tight text-slate-900 rx-num">{c.value}</p>
                <p className="text-[11.5px] text-slate-400">{c.hint}</p>
              </div>
            ))}
          </div>
          {!found.ok && found.note && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-[12px] text-amber-800 ring-1 ring-amber-200">
              Oxirgi yangilash o‘tmadi ({found.note}) — raqamlar eski bo‘lishi mumkin.
            </p>
          )}
        </>
      )}
    </div>
  );
}
