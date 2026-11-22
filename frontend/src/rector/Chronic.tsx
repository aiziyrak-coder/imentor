import { UserCheck, UserX } from 'lucide-react';
import type { ChronicDayKind, ChronicInfo, ChronicWindow } from './rectorApi';

/**
 * «Surunkalilar» (2026-11-19). Rektor: "doimiy muammo bo'layotgan o'qituvchilar ro'yxati chiqsin, unga
 * biriktirilgan mas'uli ham chiqsin". Har kartada: mas'ul, oxirgi dars kunlari tasmasi (har kun bitta kvadrat),
 * nechta kun va qanday muammo, ketma-ketlik va oxirgi yaxshi kun.
 */

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
export const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}-${MONTHS[(m || 1) - 1]}`;
};

export const DAY_KIND: Record<ChronicDayKind, { label: string; cls: string }> = {
  ok: { label: 'iMentor’da o‘tgan', cls: 'bg-emerald-500' },
  misuse: { label: 'test/keys sharti bajarilmagan', cls: 'bg-amber-400' },
  short: { label: 'kirib chiqqan (40 daqiqaga yetmagan)', cls: 'bg-orange-500' },
  none: { label: 'umuman ochmagan', cls: 'bg-rose-500' },
};

export function ChronicRule({ w }: { w: ChronicWindow }) {
  return (
    <div className="ios-card space-y-2 px-4 py-3 text-[13.5px] leading-relaxed text-slate-600">
      <p>
        <b className="text-slate-800">Kim surunkali:</b> {shortDay(w.from)} – {shortDay(w.to)} ({w.days} kun) oralig‘ida
        kamida <b>{w.min_bad_days}</b> ta dars kunida muammo bo‘lgan va bu uning dars kunlarining kamida{' '}
        <b>{w.min_share}%</b>i. Kunda bitta dars ham yashil bo‘lmasa — o‘sha kun muammoli. Ta’til, kasallik varaqasi,
        «boshqa joyda dars» qaydi va magistratura darslari hisobga kirmaydi. Test/keys sharti {shortDay(w.module_rule_from)}dan
        boshlab hisoblanadi.
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {(Object.keys(DAY_KIND) as ChronicDayKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-[3px] ${DAY_KIND[k].cls}`} /> {DAY_KIND[k].label}
          </span>
        ))}
      </p>
    </div>
  );
}

export default function ChronicBlock({ c }: { c: ChronicInfo }) {
  const kinds = [
    c.none_days ? `${c.none_days} kun umuman ochmagan` : '',
    c.short_days ? `${c.short_days} kun kirib chiqqan` : '',
    c.misuse_days ? `${c.misuse_days} kun test/keyssiz` : '',
  ].filter(Boolean);
  return (
    <div className="mt-3 space-y-2.5" data-testid="chronic-block">
      {c.responsible.length ? (
        <div className="flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-100">
          <UserCheck size={16} className="mt-[2px] shrink-0 text-indigo-600" />
          <div className="min-w-0 text-[13px] leading-snug">
            <span className="text-indigo-900">Mas’ul: </span>
            {c.responsible.map((r, i) => (
              <span key={r.name}>
                {i > 0 && ', '}
                <b className="text-indigo-950">{r.name}</b>
                {r.position && <span className="text-indigo-800/80"> ({r.position})</span>}
                {c.departments.length > 1 && <span className="text-indigo-800/80"> — {r.departments.join(', ')}</span>}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[13px] text-slate-600">
          <UserX size={16} className="shrink-0 text-slate-400" /> Kafedraga mas’ul biriktirilmagan
        </div>
      )}
      <div>
        <div className="flex flex-wrap gap-1" aria-label="Oxirgi dars kunlari">
          {c.strip.map((d) => (
            <span key={d.date} title={`${shortDay(d.date)} — ${DAY_KIND[d.kind].label}`}
              className={`h-4 w-4 rounded-[4px] ${DAY_KIND[d.kind].cls}`} />
          ))}
        </div>
        <p className="mt-1 text-[11.5px] text-slate-400">
          oxirgi {c.strip.length} dars kuni{c.strip.length ? ` · ${shortDay(c.strip[0].date)} – ${shortDay(c.strip[c.strip.length - 1].date)}` : ''}
        </p>
      </div>
      <p className="text-[14px] text-slate-700">
        <b className="text-rose-700 rx-num">{c.bad_days}</b> / {c.lesson_days} dars kunida muammo
        <span className="text-slate-500"> ({c.share}%)</span>
      </p>
      {kinds.length > 0 && <p className="text-[13px] text-slate-600">{kinds.join(' · ')}</p>}
      <p className="text-[12.5px] text-slate-500">
        {c.streak > 1 ? <>Oxirgi <b className="text-rose-700">{c.streak}</b> dars kuni ketma-ket muammoli · </> : null}
        {c.last_ok ? `oxirgi yaxshi kun: ${shortDay(c.last_ok)}` : 'shu davrda bitta ham yaxshi kun yo‘q'}
      </p>
    </div>
  );
}
