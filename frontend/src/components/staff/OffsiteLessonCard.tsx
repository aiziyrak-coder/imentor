import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, MapPinned } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import { useUiText } from '../../i18n/useUiText';
import type { UiTextKey } from '../../i18n/translations';
import {
  OFFSITE_REASONS,
  currentPosition,
  fetchCurrentLessons,
  submitOffsiteLesson,
  type CurrentLesson,
  type OffsiteReason,
} from '../../utils/offsiteLessonApi';

/**
 * "Darsni boshqa joyda o'tyapman" (2026-11-12): o'qituvchi darsni monitorli xonada emas, boshqa joyda
 * o'tsa — dars VAQTIDA sabab, izoh va kameradan rasm bilan qayd etadi. Tasdiqsiz: dars rektor
 * hisobotida qizil bo'lmaydi, admin «Boshqa joyda darslar» hisobotida ko'radi.
 * Kartochka faqat jadvalda shu payt darsi bo'lsa chiqadi.
 */
export default function OffsiteLessonCard() {
  const { t } = useUiText();
  const [lessons, setLessons] = useState<CurrentLesson[]>([]);
  const [next, setNext] = useState<CurrentLesson | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [reason, setReason] = useState<OffsiteReason>('klinika');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Jadval yuklanmadi — "hozir darsingiz yo'q" deb ko'rsatilmaydi (2026-11-17 audit:
   *  ilgari xatoda ro'yxat bo'shatilib, darsi bor o'qituvchi tugmani nofaol ko'rardi). */
  const [loadFailed, setLoadFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetchCurrentLessons()
      .then((r) => {
        setLessons(r.lessons || []);
        setNext(r.next_lesson || null);
        setLoadFailed(false);
      })
      // Oldingi (muvaffaqiyatli) ro'yxat saqlanib qoladi — bir martalik uzilish
      // ochiq formani yopib yubormasin.
      .catch(() => setLoadFailed(true))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
    // Para almashganda kartochka yangilansin.
    const timer = window.setInterval(load, 120_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (file: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : '');
  };

  const reset = () => {
    setOpen(null);
    setReason('klinika');
    setNote('');
    pick(null);
    setError('');
  };

  const send = async (lesson: CurrentLesson) => {
    if (!photo) return setError(t('staff.offsite.needPhoto'));
    // Izoh har qanday sababda majburiy — rektor hisobotida rasm bilan birga ko'rinadi.
    if (note.trim().length < 5) return setError(t('staff.offsite.needNote'));
    setBusy(true);
    setError('');
    try {
      const position = await currentPosition();
      await submitOffsiteLesson({ lessonId: lesson.lesson_id, reason, note: note.trim(), photo, position });
      reset();
      load();
    } catch (e) {
      const detail = e instanceof HttpError ? (e.body as { detail?: unknown } | null)?.detail : null;
      setError(typeof detail === 'string' && detail ? detail : t('staff.offsite.failed'));
    } finally {
      setBusy(false);
    }
  };

  // Hozir darsi bo'lmasa ham kartochka ko'rinadi (2026-11-12, "umuman chiqmayapti"): tugma nofaol,
  // qachon faollashishi yoziladi — aks holda o'qituvchi funksiya yo'q deb o'ylardi.
  if (!lessons.length) {
    if (!loaded) return null;
    return (
      <section className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200" data-testid="offsite-idle">
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-200 px-4 py-3 text-[15px] font-semibold text-slate-500"
        >
          <MapPinned size={18} /> {t('staff.offsite.title')}
        </button>
        {loadFailed ? (
          <p role="alert" className="mt-1.5 text-[12.5px] leading-snug text-rose-700">
            {t('staff.offsite.loadFailed')}{' '}
            <button
              type="button"
              onClick={load}
              className="font-semibold underline underline-offset-2 hover:text-rose-900"
            >
              {t('common.retry')}
            </button>
          </p>
        ) : (
        <p className="mt-1.5 text-[12.5px] leading-snug text-slate-500">
          {next
            ? t('staff.offsite.idleNext', {
              para: next.para,
              time: `${next.start_time}–${next.end_time}`,
              subject: next.subject_name,
              group: next.group_name,
            })
            : t('staff.offsite.idleNone')}
        </p>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-2" data-testid="offsite-card">
      {lessons.map((lesson) => (
        <section key={lesson.lesson_id} className="rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200">
          <p className="text-[12.5px] text-slate-500">
            {t('staff.offsite.lessonLine', {
              para: lesson.para,
              time: `${lesson.start_time}–${lesson.end_time}`,
              subject: lesson.subject_name,
              group: lesson.group_name,
            })}
          </p>
          {lesson.marked ? (
            <p className="mt-2 flex items-center gap-2 text-[14px] font-medium text-emerald-700">
              <Check size={18} /> {t('staff.offsite.done', { reason: lesson.reason_label })}
            </p>
          ) : open !== lesson.lesson_id ? (
            <>
              <button
                type="button"
                onClick={() => { reset(); setOpen(lesson.lesson_id); }}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[15px] font-semibold text-white"
              >
                <MapPinned size={18} /> {t('staff.offsite.title')}
              </button>
              <p className="mt-1.5 text-[12.5px] leading-snug text-slate-500">{t('staff.offsite.hint')}</p>
            </>
          ) : (
            <div className="mt-3 space-y-3">
              <label className="block text-[13px] font-medium text-slate-700">
                {t('staff.offsite.reason')}
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as OffsiteReason)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px]"
                >
                  {OFFSITE_REASONS.map((r) => (
                    <option key={r} value={r}>{t(`staff.offsite.reason.${r}` as UiTextKey)}</option>
                  ))}
                </select>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="offsite-photo"
                onChange={(e) => pick(e.target.files?.[0] || null)}
              />
              {preview ? (
                <div className="space-y-1.5">
                  <img src={preview} alt="" className="max-h-56 w-full rounded-xl object-cover" />
                  <button type="button" onClick={() => fileRef.current?.click()} className="text-[13px] font-medium text-blue-600">
                    {t('staff.offsite.photoRetake')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-[15px] font-medium text-slate-700"
                >
                  <Camera size={18} /> {t('staff.offsite.photo')}
                </button>
              )}
              <label className="block text-[13px] font-medium text-slate-700">
                {t('staff.offsite.note')}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={3}
                  required
                  placeholder={t('staff.offsite.notePlaceholder')}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[15px]"
                />
              </label>
              {error && <p className="text-[13px] text-rose-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={reset} className="flex-1 rounded-xl px-4 py-3 text-[14px] font-medium text-slate-500 ring-1 ring-slate-200">
                  {t('staff.offsite.cancel')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void send(lesson)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-[14px] font-semibold text-white disabled:opacity-60"
                >
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {busy ? t('staff.offsite.sending') : t('staff.offsite.submit')}
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
