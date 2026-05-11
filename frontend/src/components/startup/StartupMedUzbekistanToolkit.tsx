import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  ChevronDown,
  ClipboardList,
  Copy,
  FlaskConical,
  Globe2,
  HeartPulse,
  Landmark,
  Layers,
  Lightbulb,
  Lock,
  MapPinned,
  Microscope,
  Rocket,
  Scale,
  ShieldCheck,
  Stethoscope,
  Target,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  buildMedToolkitPlainTextWithChecks,
  buildSectionPlainText,
  computeMedToolkitProgress,
  MED_TOOLKIT_ITEMS,
  normalizeItemChecks,
  type MedToolkitChecks,
} from '../../utils/startupMedToolkitModel';

const ICON_BY_ID: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  'problem-payer': Target,
  'regulatory-map': Scale,
  'pilot-design': Stethoscope,
  'device-software-path': Layers,
  'data-privacy': Lock,
  'ethics-clinical': HeartPulse,
  'grants-uz': Landmark,
  'bilingual-pitch': Globe2,
  'competitive-landscape': Zap,
  'ip-strategy': BookOpen,
  'team-triangle': Users,
  'monetization-b2g': Wallet,
  'telemed-uz': Microscope,
  'ai-med-evidence': FlaskConical,
  'lab-integration': Building2,
  'quality-systems': ShieldCheck,
  'public-procurement': ClipboardList,
  'regional-expansion': MapPinned,
  'university-incubation': Lightbulb,
  'stress-test-30': Rocket,
};

export default function StartupMedUzbekistanToolkit({
  checks,
  onChecksChange,
  disabled,
  noProjectYet,
}: {
  checks: MedToolkitChecks;
  onChecksChange: (next: MedToolkitChecks) => void;
  disabled: boolean;
  /** Loyiha tanlanmaguncha checklist o‘zgartirish mumkin emas */
  noProjectYet: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(MED_TOOLKIT_ITEMS[0]?.id ?? null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const stats = useMemo(() => computeMedToolkitProgress(checks), [checks]);
  const plainAll = useMemo(() => buildMedToolkitPlainTextWithChecks(checks), [checks]);

  const effectiveDisabled = disabled || noProjectYet;

  const toggleAction = (itemId: string, actionIndex: number, actionCount: number) => {
    if (effectiveDisabled) return;
    const row = normalizeItemChecks(itemId, actionCount, checks);
    const nextRow = [...row];
    nextRow[actionIndex] = !nextRow[actionIndex];
    onChecksChange({ ...checks, [itemId]: nextRow });
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(plainAll);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      window.prompt('Nusxalash uchun matn:', plainAll.slice(0, 8000));
    }
  };

  const copySection = async (itemId: string) => {
    const text = buildSectionPlainText(itemId, checks);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(itemId);
      window.setTimeout(() => setCopiedSection(null), 2000);
    } catch {
      window.prompt('Nusxalash:', text);
    }
  };

  return (
    <section className="rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white to-cyan-50/70 p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-md">
            <Rocket size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-black/90 leading-snug">
              O‘zbekiston tibbiyot startapi — 20 ta kuchaytirish
            </h2>
            <p className="text-[12px] text-black/55 mt-1 leading-relaxed">
              Har bir bandda checkboxlar — holat loyiha bilan serverga yoziladi (avtomatik saqlash ~1 s). AI tahlil va
              maslahatchi bajarilgan qadamlarni inobatga oladi.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="h-2 w-36 max-w-full rounded-full bg-black/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-teal-500 transition-all"
                  style={{ width: `${stats.percent}%` }}
                />
              </div>
              <span className="text-[12px] font-semibold text-teal-900 tabular-nums">
                {stats.done}/{stats.total} qadam ({stats.percent}%) · {stats.sectionsComplete}/20 bo‘lim yakun
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-teal-300/80 bg-white/90 px-3 py-2 text-[12px] font-semibold text-teal-900 hover:bg-teal-50"
        >
          <Copy size={14} />
          {copiedAll ? 'Nusxalandi' : 'Hammasini nusxalash'}
        </button>
      </div>

      {noProjectYet && (
        <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
          Checklistni ishlatish uchun avval <strong>«Yangi loyiha»</strong> yarating va loyihani tanlang.
        </p>
      )}
      {effectiveDisabled && !noProjectYet && (
        <p className="text-[12px] text-black/50 bg-black/[0.04] rounded-xl px-3 py-2 mb-3">
          Loyiha yuborilgan — checklist faqat ko‘rish rejimida.
        </p>
      )}

      <div className="space-y-2">
        {MED_TOOLKIT_ITEMS.map((item, index) => {
          const Icon = ICON_BY_ID[item.id] ?? Rocket;
          const expanded = openId === item.id;
          const row = normalizeItemChecks(item.id, item.actions.length, checks);
          const doneInSection = row.filter(Boolean).length;
          return (
            <div
              key={item.id}
              className="rounded-xl border border-black/8 bg-white/85 overflow-hidden shadow-sm"
            >
              <button
                type="button"
                onClick={() => setOpenId(expanded ? null : item.id)}
                className="w-full flex items-center gap-3 text-left px-3 py-2.5 hover:bg-black/[0.02]"
              >
                <span className="text-[11px] font-black text-teal-700 tabular-nums w-6 shrink-0">{index + 1}</span>
                <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center shrink-0">
                  <Icon size={16} />
                </div>
                <span className="flex-1 text-[13px] font-semibold text-black/88 leading-snug min-w-0">
                  {item.title}
                </span>
                <span className="text-[11px] font-bold text-black/40 tabular-nums shrink-0">
                  {doneInSection}/{item.actions.length}
                </span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-black/35 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded && (
                <div className="px-3 pb-3 pt-0 border-t border-black/5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mt-2 mb-2">
                    <p className="text-[12px] text-black/60 leading-relaxed flex-1 min-w-0">{item.lead}</p>
                    <button
                      type="button"
                      onClick={() => void copySection(item.id)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50/80 px-2 py-1 text-[11px] font-semibold text-teal-900"
                    >
                      <Copy size={12} />
                      {copiedSection === item.id ? 'OK' : 'Bo‘limni nusxalash'}
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {item.actions.map((label, i) => (
                      <li key={`${item.id}-${i}`} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={row[i]}
                          disabled={effectiveDisabled}
                          onChange={() => toggleAction(item.id, i, item.actions.length)}
                          className="mt-1 size-4 rounded border-black/20 text-teal-600 disabled:opacity-40"
                          aria-label={label}
                        />
                        <span className="text-[12px] text-black/85 leading-relaxed">{label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
