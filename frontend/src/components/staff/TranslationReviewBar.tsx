import { useState } from 'react';
import { BadgeCheck, Bot, Loader2 } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import type { AppLanguage } from '../../i18n/language';
import { reviewPreparedTranslation } from '../../utils/preparedContentStore';
import { staffBtnGhost, staffBtnSecondary } from './staffUi';

type ReviewRecord = { status?: string; at?: string };
type ReviewablePayload = {
  primaryLanguage?: string;
  translations?: Partial<Record<AppLanguage, object>>;
  translationReview?: Partial<Record<AppLanguage, ReviewRecord>>;
};

/**
 * Test/keys tarjimasi AI niki yoki o'qituvchi tekshirganmi (2026-11-17, fermi.uz).
 *
 * Bazadagi tarjimalarni AI qilgan. O'qituvchi tarjima tilida materialni ko'rib, "Tarjimani tasdiqlash"
 * ni bossa — fermi.uz saytida "AI tarjimasi" belgisi olib tashlanadi. Faqat tarjima tilida chiqadi.
 */
export default function TranslationReviewBar<T extends ReviewablePayload>({
  payload,
  versionId,
  lang,
  onPayload,
}: {
  payload: T | null;
  versionId: string | null;
  lang: AppLanguage;
  onPayload: (next: T) => void;
}) {
  const { t } = useUiText();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!payload || !versionId || !payload.primaryLanguage || payload.primaryLanguage === lang) return null;
  if (!payload.translations?.[lang]) return null;

  const record = payload.translationReview?.[lang];
  const reviewed = record?.status === 'reviewed';
  const date = record?.at ? record.at.slice(0, 10).split('-').reverse().join('.') : '';

  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      onPayload(await reviewPreparedTranslation<T>(versionId, lang, !reviewed));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[12.5px] leading-relaxed ring-1 ${
        reviewed ? 'bg-emerald-50/70 text-emerald-900 ring-emerald-200' : 'bg-amber-50/70 text-amber-900 ring-amber-200'
      }`}
    >
      {reviewed ? <BadgeCheck size={16} className="shrink-0" /> : <Bot size={16} className="shrink-0" />}
      <p className="min-w-0 flex-1">
        {reviewed ? t('translationReview.reviewed', { date }) : t('translationReview.ai')}
        {failed && <span className="mt-1 block font-medium text-rose-700">{t('translationReview.failed')}</span>}
      </p>
      <button type="button" onClick={toggle} disabled={busy} className={reviewed ? staffBtnGhost : staffBtnSecondary}>
        {busy && <Loader2 size={14} className="animate-spin" />}
        {reviewed ? t('translationReview.undo') : t('translationReview.confirm')}
      </button>
    </div>
  );
}
