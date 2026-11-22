import { BookOpen } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import type { MedicalReference } from '../../utils/medicalReferences';

/**
 * Savol / keys ostida doim ko'rinadigan manba qatori (2026-11-18).
 *
 * Kafedralar: "testda ham, keysda ham manba qaysi kitobligi, qaysi betdan olingani chiqmayapti". Manba
 * bor edi, lekin faqat «to'g'ri javob tahlili» ichida (keysda — javob ochilgandagina) — o'qituvchi uni
 * ko'rmasdi. Endi kitob va protokol manbasi savol matnining ostida: "📖 Manba: Kitob — 45-bet".
 * Internet manbalari (havolali) bu qatorda ko'rsatilmaydi.
 */
export default function QuestionSource({ references, max = 2 }: { references?: MedicalReference[]; max?: number }) {
  const { t } = useUiText();
  const own = (references || []).filter((r) => r && r.title && !r.url && r.kind !== 'pubmed' && r.kind !== 'scholar'
    && r.kind !== 'wikipedia' && r.kind !== 'journal');
  if (!own.length) return null;
  const seen = new Set<string>();
  const items = own.filter((r) => {
    const key = `${r.title}|${r.pages || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
  return (
    <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-emerald-800" data-testid="question-source">
      <BookOpen size={14} className="mt-[1px] shrink-0" />
      <span>
        <span className="font-semibold">{t('test.sourceLabel')}:</span>{' '}
        {items.map((r, i) => (
          <span key={i}>
            {i > 0 ? '; ' : ''}
            {r.title}
            {r.pages ? <span className="text-emerald-700/80"> — {r.pages}-bet</span> : null}
          </span>
        ))}
      </span>
    </p>
  );
}
