import React from 'react';
import type { VisualBlock } from '../../services/presentationTypes';

type Props = {
  visual: VisualBlock;
  variant?: 'editor' | 'presenter';
  accent?: string;
};

const accentDefault = '#0ea5e9';

export default function MedicalSlideVisual({ visual, variant = 'editor', accent = accentDefault }: Props) {
  const compact = variant === 'editor';
  const base = `w-full h-full min-h-[${compact ? '200' : '240'}px] flex flex-col`;

  if (visual.type === 'stats' && visual.stats?.length) {
    return (
      <div className={base}>
        {visual.caption && (
          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700/80 mb-2">{visual.caption}</p>
        )}
        <div className="grid grid-cols-2 gap-2 flex-1">
          {visual.stats.slice(0, 4).map((s, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/40 bg-white/20 backdrop-blur-md p-3 flex flex-col justify-center shadow-lg"
              style={{ boxShadow: `0 8px 32px ${accent}22` }}
            >
              <div
                className="text-2xl md:text-4xl font-black tabular-nums tracking-tight"
                style={{ color: accent, textShadow: `0 0 24px ${accent}55` }}
              >
                {s.value}
                {s.unit && <span className="text-base font-semibold ml-0.5 opacity-80">{s.unit}</span>}
              </div>
              <div className="text-[11px] md:text-xs font-semibold text-slate-700 leading-snug mt-1 line-clamp-3">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual.type === 'flow' && visual.steps?.length) {
    const steps = visual.steps.slice(0, 5);
    return (
      <div className={base}>
        {visual.caption && <p className="text-[11px] font-bold text-sky-800 mb-2">{visual.caption}</p>}
        <div className="flex-1 flex flex-col justify-center gap-1.5">
          {steps.map((step, i) => (
            <div key={i} className="flex items-stretch gap-2">
              <div
                className="w-8 shrink-0 rounded-lg flex items-center justify-center text-white text-sm font-bold shadow-md"
                style={{ background: accent }}
              >
                {i + 1}
              </div>
              <div className="flex-1 rounded-lg border border-slate-200/90 bg-white/90 px-2.5 py-1.5 shadow-sm">
                <div className="text-[12px] md:text-sm font-bold text-slate-800 leading-tight">{step.label}</div>
                {step.detail && (
                  <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{step.detail}</div>
                )}
              </div>
              {i < steps.length - 1 && (
                <div className="absolute left-4 hidden" aria-hidden />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual.type === 'compare' && visual.left && visual.right) {
    return (
      <div className={base}>
        <div className="grid grid-cols-2 gap-2 flex-1">
          {[visual.left, visual.right].map((col, ci) => (
            <div
              key={ci}
              className={`rounded-xl border-2 p-2.5 flex flex-col ${
                ci === 0 ? 'border-emerald-300 bg-emerald-50/80' : 'border-amber-300 bg-amber-50/80'
              }`}
            >
              <h4 className="text-[12px] font-bold mb-2 text-slate-800">{col.title}</h4>
              <ul className="space-y-1 flex-1">
                {(col.items || []).slice(0, 4).map((item, ii) => (
                  <li key={ii} className="text-[10px] md:text-[11px] text-slate-700 flex gap-1.5 leading-snug">
                    <span className="text-emerald-600 font-bold">{ci === 0 ? '✓' : '△'}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual.type === 'pyramid' && visual.levels?.length) {
    const levels = visual.levels.slice(0, 4);
    return (
      <div className={`${base} items-center justify-center py-1`}>
        <div className="w-full max-w-md space-y-1">
          {levels.map((lv, i) => {
            const w = 100 - i * 18;
            return (
              <div
                key={i}
                className="mx-auto rounded-lg border border-slate-200 px-2 py-1.5 text-center shadow-sm"
                style={{ width: `${w}%`, background: `color-mix(in srgb, ${accent} ${20 - i * 4}%, white)` }}
              >
                <div className="text-[10px] font-bold text-slate-800">{lv.label}</div>
                <div className="text-[9px] text-slate-600 line-clamp-1">{(lv.items || [])[0]}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (visual.type === 'timeline' && visual.events?.length) {
    return (
      <div className={base}>
        <div className="relative flex-1 pl-4 border-l-2 border-sky-400 space-y-2 py-1">
          {visual.events.slice(0, 5).map((ev, i) => (
            <div key={i} className="relative">
              <div
                className="absolute -left-[21px] top-1 w-3 h-3 rounded-full border-2 border-white shadow"
                style={{ background: accent }}
              />
              <div className="text-[10px] font-bold text-sky-700">{ev.time}</div>
              <div className="text-[11px] text-slate-700 leading-snug">{ev.text}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual.type === 'cycle' && visual.nodes?.length) {
    const nodes = visual.nodes.slice(0, 6);
    const n = nodes.length;
    const r = compact ? 72 : 88;
    const cx = 120;
    const cy = 100;
    return (
      <div className={`${base} items-center justify-center`}>
        <svg viewBox="0 0 240 200" className="w-full max-h-[220px]">
          {nodes.map((node, i) => {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            const next = nodes[(i + 1) % n];
            const na = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
            const x2 = cx + r * Math.cos(na);
            const y2 = cy + r * Math.sin(na);
            return (
              <g key={node.id}>
                <line x1={x} y1={y} x2={x2} y2={y2} stroke={accent} strokeWidth="2" markerEnd="url(#arr)" />
                <circle cx={x} cy={y} r="28" fill="white" stroke={accent} strokeWidth="2" />
                <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#1e293b">
                  {node.label.slice(0, 14)}
                </text>
              </g>
            );
          })}
          <defs>
            <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill={accent} />
            </marker>
          </defs>
        </svg>
      </div>
    );
  }

  if (visual.type === 'table' && visual.rows?.length) {
    const [head, ...body] = visual.rows;
    return (
      <div className={`${base} overflow-auto`}>
        <table className="w-full text-[10px] md:text-[11px] border-collapse rounded-lg overflow-hidden shadow-sm">
          {head && (
            <thead>
              <tr className="bg-sky-700 text-white">
                {head.map((c, i) => (
                  <th key={i} className="px-2 py-1.5 text-left font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.slice(0, 5).map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-sky-50/50'}>
                {row.map((c, ci) => (
                  <td key={ci} className="px-2 py-1 border-t border-slate-100 text-slate-700">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (visual.type === 'icon-grid' && visual.icons?.length) {
    return (
      <div className={base}>
        <div className="grid grid-cols-2 gap-2 flex-1">
          {visual.icons.slice(0, 6).map((ic, i) => (
            <div
              key={i}
              className="rounded-xl bg-white/90 border border-slate-200/80 p-2 flex gap-2 items-start shadow-sm"
            >
              <span className="text-xl shrink-0">{ic.icon}</span>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-sky-800">{ic.label}</div>
                <div className="text-[10px] text-slate-600 leading-snug line-clamp-3">{ic.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (visual.type === 'clinical' && visual.vignette) {
    const v = visual.vignette;
    return (
      <div className={`${base} rounded-xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 to-white p-3 shadow-inner`}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-rose-700 mb-1">Klinik vaziyat</div>
        <p className="text-[12px] md:text-sm font-semibold text-slate-800 mb-2">{v.patient}</p>
        <ul className="space-y-1 mb-2 flex-1">
          {(v.findings || []).map((f, i) => (
            <li key={i} className="text-[11px] text-slate-700 flex gap-1.5">
              <span className="text-rose-500">▸</span>
              {f}
            </li>
          ))}
        </ul>
        <div className="rounded-lg bg-rose-100/80 border border-rose-200 px-2 py-1.5 text-[11px] font-semibold text-rose-900">
          ? {v.question}
        </div>
      </div>
    );
  }

  return (
    <div className={`${base} items-center justify-center text-slate-400 text-sm`}>
      Vizual ma&apos;lumot yuklanmoqda…
    </div>
  );
}
