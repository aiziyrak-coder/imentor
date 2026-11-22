import React from 'react';
import {
  AlertCircle,
  ClipboardList,
  FileText,
  FlaskConical,
  History,
  Leaf,
  Stethoscope,
  Target,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { AppLanguage } from '../../i18n/language';
import type { CaseStudyFocus } from '../../utils/generationVariety';
import { isPatientFree, type SubjectDomain } from '../../utils/subjectDomain';
import { parseCaseScenario } from '../../utils/parseCaseScenario';
import { emphasizeClinicalCues, renderBold, stripBold } from '../../utils/boldMarkers';
import { useUiText } from '../../i18n/useUiText';
import type { UiTextKey } from '../../i18n/translations';

type Props = {
  text: string;
  language?: AppLanguage;
  focus?: CaseStudyFocus;
  domain?: SubjectDomain;
  className?: string;
};

const TASK_KEY: Record<CaseStudyFocus, UiTextKey> = {
  tashxis: 'case.taskTashxis',
  davolash: 'case.taskDavolash',
  profilaktika: 'case.taskProfilaktika',
};

const TASK_KEY_ACADEMIC: Record<CaseStudyFocus, UiTextKey> = {
  tashxis: 'case.taskTashxisAcademic',
  davolash: 'case.taskDavolashAcademic',
  profilaktika: 'case.taskProfilaktikaAcademic',
};

const TASK_TITLE_RE = /^(topshiriq|задание|task)$/i;

/**
 * Bo'lim turi sarlavhasidan (uz/ru/en) — ikonka va rang (2026-10-21).
 *
 * Shikoyat: keys "kitobga o'xshaydi, zerikarli". Endi har bo'lim o'z
 * belgisi bilan alohida kartochka: talaba ko'z bilan bo'limlarni tez topadi.
 */
type Tone = { icon: LucideIcon; chip: string; ring: string; tint: string };

const TONES: { re: RegExp; tone: Tone }[] = [
  { re: /bemor|пациент|больн|patient|method|usul|holat|ситуац|situation/i,
    tone: { icon: UserRound, chip: 'bg-sky-100 text-sky-800', ring: 'border-sky-200/80', tint: 'bg-sky-50/50' } },
  { re: /shikoyat|жалоб|complaint|presenting/i,
    tone: { icon: AlertCircle, chip: 'bg-rose-100 text-rose-800', ring: 'border-rose-200/80', tint: 'bg-rose-50/40' } },
  { re: /anamnez|анамнез|history/i,
    tone: { icon: History, chip: 'bg-amber-100 text-amber-800', ring: 'border-amber-200/80', tint: 'bg-amber-50/40' } },
  { re: /hayot|образ жизни|lifestyle|social|ijtimoiy/i,
    tone: { icon: Leaf, chip: 'bg-emerald-100 text-emerald-800', ring: 'border-emerald-200/80', tint: 'bg-emerald-50/40' } },
  { re: /ko[‘'’ʻ`]?rik|осмотр|exam|finding|topilma|natija|результат|observ|kuzatil/i,
    tone: { icon: Stethoscope, chip: 'bg-violet-100 text-violet-800', ring: 'border-violet-200/80', tint: 'bg-violet-50/40' } },
  { re: /laborator|лаборатор|lab|investigat|tahlil|анализ|imaging|tekshiruv|исследован|ma[‘'’ʻ`]?lumot|данные|data/i,
    tone: { icon: FlaskConical, chip: 'bg-teal-100 text-teal-800', ring: 'border-teal-200/80', tint: 'bg-teal-50/40' } },
  { re: /topshiriq|задание|task|savol|вопрос|question/i,
    tone: { icon: Target, chip: 'bg-indigo-100 text-indigo-800', ring: 'border-indigo-200/80', tint: 'bg-indigo-50/50' } },
];

const DEFAULT_TONE: Tone = {
  icon: FileText, chip: 'bg-slate-100 text-slate-700', ring: 'border-slate-200/80', tint: 'bg-white',
};

export function toneOfSection(title: string): Tone {
  const plain = stripBold(title);
  return TONES.find((x) => x.re.test(plain))?.tone ?? DEFAULT_TONE;
}

/** Keys matni: AI qo'ygan qalin joylar + kod topgan klinik ko'rsatkichlar. */
function body(text: string, key: string): React.ReactNode {
  return renderBold(emphasizeClinicalCues(text), key);
}

/** Klinik keys — bo'limlari ajralgan, muhim belgilari qalin kartochka. */
export default function CaseScenarioView({
  text,
  language = 'uz',
  focus,
  domain = 'clinical',
  className = '',
}: Props) {
  const { t } = useUiText();
  const blocks = parseCaseScenario(text, language);
  const keys = isPatientFree(domain) ? TASK_KEY_ACADEMIC : TASK_KEY;
  // 2026-10-20 dan keys o'zining aniq "Topshiriq" bo'limi bilan keladi —
  // unda fokusga bog'langan umumiy savol takror ko'rsatilmaydi.
  const hasOwnTask = blocks.some((b) => TASK_TITLE_RE.test(stripBold(b.title)));
  const task = focus && !hasOwnTask ? t(keys[focus]) : '';
  const taskLabel = t('case.taskLabel');

  if (blocks.length === 1 && !blocks[0].title) {
    return (
      <div className={className}>
        <p className="text-[15.5px] leading-[1.75] text-slate-800 whitespace-pre-wrap">
          {body(blocks[0].body, 'one')}
        </p>
        {task ? <TaskBanner label={taskLabel} text={task} /> : null}
      </div>
    );
  }

  // Birinchi bo'lim (bemor / usul) — kirish: kengroq, kartochkasiz.
  const [lead, ...rest] = blocks;
  const tasks = rest.filter((b) => TASK_TITLE_RE.test(stripBold(b.title)));
  const sections = rest.filter((b) => !TASK_TITLE_RE.test(stripBold(b.title)));
  const LeadIcon = toneOfSection(lead.title).icon;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-start gap-3 rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-white px-4 py-3.5 sm:px-5">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-600 text-white shadow-sm">
          <LeadIcon size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-700">{stripBold(lead.title)}</p>
          <p className="mt-1 text-[15.5px] leading-[1.7] text-slate-800 whitespace-pre-wrap">{body(lead.body, lead.id)}</p>
        </div>
      </div>

      {sections.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {sections.map((block, i) => {
            const tone = toneOfSection(block.title);
            const Icon = tone.icon;
            // Uzun bo'lim (ko'rik, tahlillar) ikki ustunni egallaydi — o'qish oson.
            // Toq sonli ro'yxatning oxirgisi ham: yonida bo'sh joy qolmasin.
            const lastOdd = i === sections.length - 1 && sections.length % 2 === 1;
            const wide = block.body.length > 420 || lastOdd;
            return (
              <section
                key={block.id}
                className={`rounded-2xl border ${tone.ring} ${tone.tint} px-4 py-3.5 sm:px-5 print:break-inside-avoid ${wide ? 'lg:col-span-2' : ''}`}
              >
                <h4 className="mb-1.5 flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tone.chip}`}>
                    <Icon size={13} />
                    {stripBold(block.title)}
                  </span>
                </h4>
                {/* Klinik fikrlash uchun muhim joylar qalin: AI ularni `**...**`
                    bilan belgilaydi, o'lchov qiymatlarini kod qo'shadi. */}
                <p className="text-[14.5px] sm:text-[15px] leading-[1.7] text-slate-800 whitespace-pre-wrap">
                  {body(block.body, block.id)}
                </p>
              </section>
            );
          })}
        </div>
      )}

      {tasks.map((block) => (
        <TaskBanner key={block.id} label={stripBold(block.title)} text={block.body} rich />
      ))}
      {task ? <TaskBanner label={taskLabel} text={task} /> : null}
    </div>
  );
}

function TaskBanner({ label, text, rich = false }: { label: string; text: string; rich?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3.5 sm:px-5 print:break-inside-avoid">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
        <ClipboardList size={16} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-700">{label}</p>
        <p className="mt-1 text-[14.5px] leading-[1.65] text-indigo-950 whitespace-pre-wrap">
          {rich ? renderBold(text, 'task') : text}
        </p>
      </div>
    </div>
  );
}
