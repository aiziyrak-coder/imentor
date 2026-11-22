import React, { useState } from 'react';
import { GraduationCap, Presentation } from 'lucide-react';
import { useUiText } from '../../i18n/useUiText';
import { chooseSessionRole } from '../../utils/backendAuth';
import type { UserRole } from '../../utils/localStaffAuth';

/**
 * Ham talaba, ham o'qituvchi (2026-10-28): magistrant stajer-o'qituvchi bitta hisob bilan
 * kiradi va qaysi profil bilan davom etishini tanlaydi. Rol serverda ham tekshiriladi.
 */
export default function RoleChoiceScreen({
  roles,
  name,
  onChosen,
}: {
  roles: UserRole[];
  name: string;
  onChosen: () => void;
}) {
  const { t } = useUiText();
  const [busy, setBusy] = useState<UserRole | null>(null);
  const [error, setError] = useState(false);

  const choose = async (role: UserRole) => {
    if (busy) return;
    setBusy(role);
    setError(false);
    try {
      await chooseSessionRole(role);
      onChosen();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const cards: { role: UserRole; icon: React.ReactNode; title: string; body: string; tone: string }[] = [
    {
      role: 'hodim',
      icon: <Presentation size={28} strokeWidth={1.8} />,
      title: t('roleChoice.teacherTitle'),
      body: t('roleChoice.teacherBody'),
      tone: 'bg-blue-50 text-blue-600',
    },
    {
      role: 'student',
      icon: <GraduationCap size={28} strokeWidth={1.8} />,
      title: t('roleChoice.studentTitle'),
      body: t('roleChoice.studentBody'),
      tone: 'bg-emerald-50 text-emerald-600',
    },
  ];

  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-[#f4f6fa] px-4"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="mx-auto mb-3 h-14 w-14 rounded-2xl border border-white/70 bg-white object-cover shadow-lg"
          />
          <h1 className="text-xl font-bold tracking-tight text-black/90">{t('roleChoice.title')}</h1>
          {name && <p className="mt-1 text-[15px] text-black/55">{name}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards
            .filter((c) => roles.includes(c.role))
            .map((c) => (
              <button
                key={c.role}
                type="button"
                onClick={() => void choose(c.role)}
                disabled={busy !== null}
                className="group flex flex-col items-start gap-3 rounded-[22px] border border-black/[0.06] bg-white p-5 text-left shadow-[0_1px_2px_rgba(8,48,71,0.04),0_16px_44px_-20px_rgba(8,48,71,0.20)] transition hover:-translate-y-0.5 hover:border-blue-200 disabled:opacity-60"
              >
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${c.tone}`}>{c.icon}</span>
                <span className="text-[17px] font-semibold text-black/90">{c.title}</span>
                <span className="text-[14px] leading-snug text-black/55">{c.body}</span>
                <span className="mt-1 text-[14px] font-medium text-blue-600">
                  {busy === c.role ? t('roleChoice.loading') : t('roleChoice.continue')}
                </span>
              </button>
            ))}
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-center text-sm text-rose-700">
            {t('roleChoice.error')}
          </p>
        )}
      </div>
    </div>
  );
}
