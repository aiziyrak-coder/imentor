import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { HttpError } from '../../api/httpClient';
import {
  fetchAccountSecurity,
  logoutEverywhere,
  setPasswordOnly,
  type AccountSecurity,
} from '../../utils/accountSecurityApi';
import type { SettingsText } from './teacherSettingsText';
import { clearBackendAuthTokens } from '../../utils/backendAuth';
import { logoutLocalStaff } from '../../utils/localStaffAuth';

const CARD = 'rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.07] sm:p-6';
const BTN_SECONDARY =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-[13.5px] font-semibold text-slate-700 ring-1 ring-slate-900/10 hover:bg-slate-50 disabled:opacity-50';

function message(err: unknown, fallback: string): string {
  if (err instanceof HttpError && err.message) return err.message;
  return fallback;
}

/**
 * "Kirish va xavfsizlik" bo'limida: o'qituvchi hisobiga parolsiz (Xodim ID / JSHSHIR) kirishni
 * yopadi va barcha qurilmalardan chiqadi (2026-11-17 auditi).
 */
export default function AccountSecurityCard({ s }: { s: SettingsText }) {
  const [state, setState] = useState<AccountSecurity | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'toggle' | 'logout'>('');
  const [done, setDone] = useState('');

  const load = useCallback(() => {
    setError('');
    fetchAccountSecurity()
      .then(setState)
      .catch((err) => setError(message(err, s.securityLoadFailed)));
  }, [s.securityLoadFailed]);

  useEffect(load, [load]);

  const toggle = async () => {
    if (!state) return;
    setBusy('toggle');
    setError('');
    setDone('');
    try {
      const next = await setPasswordOnly(!state.password_only);
      setState(next);
      setDone(next.password_only ? s.securityOnDone : s.securityOffDone);
    } catch (err) {
      setError(message(err, s.securitySaveFailed));
    } finally {
      setBusy('');
    }
  };

  const logoutAll = async () => {
    if (!window.confirm(s.securityLogoutConfirm)) return;
    setBusy('logout');
    setError('');
    try {
      await logoutEverywhere();
      clearBackendAuthTokens();
      logoutLocalStaff();
      window.location.reload();
    } catch (err) {
      setError(message(err, s.securitySaveFailed));
      setBusy('');
    }
  };

  return (
    <section className={CARD}>
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 shrink-0 text-sky-600" size={22} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-bold text-slate-900">{s.securityTitle}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{s.securityIntro}</p>

          {!state && !error ? (
            <p className="mt-3 text-[13px] text-slate-500">
              <Loader2 className="mr-1 inline animate-spin" size={14} /> {s.securityLoading}
            </p>
          ) : null}

          {state?.can_set ? (
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-sky-600"
                checked={state.password_only}
                disabled={busy !== '' || (!state.has_password && !state.password_only)}
                onChange={toggle}
              />
              <span>
                <span className="block text-[14px] font-semibold text-slate-800">{s.securityPasswordOnly}</span>
                <span className="block text-[12.5px] text-slate-500">
                  {state.has_password ? s.securityPasswordOnlyHint : s.securityNeedPassword}
                </span>
              </span>
            </label>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SECONDARY} onClick={logoutAll} disabled={busy !== '' || !state}>
              {busy === 'logout' ? <Loader2 className="animate-spin" size={14} /> : <LogOut size={14} />}
              {s.securityLogoutAll}
            </button>
            {error ? (
              <span className="text-[13px] text-rose-700">
                {error}{' '}
                {!state ? (
                  <button type="button" className="font-semibold underline" onClick={load}>
                    {s.securityRetry}
                  </button>
                ) : null}
              </span>
            ) : null}
            {done ? <span className="text-[13px] text-emerald-700">{done}</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
