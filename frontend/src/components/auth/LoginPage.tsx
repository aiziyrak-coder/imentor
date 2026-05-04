import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Phone, Lock, Shield, BriefcaseMedical, Languages, Rocket } from 'lucide-react';
import { motion } from 'motion/react';
import {
  isValidPhoneDigits,
  ensureDefaultRoleDemosExist,
  loginLocalStaff,
  normalizePhoneDigits,
  DEMO_ROLE_LOGINS,
  TEST_STAFF_PHONE,
  TEST_STAFF_PASSWORD,
} from '../../utils/localStaffAuth';

interface LoginPageProps {
  onSwitchToRegister: () => void;
}

export default function LoginPage({ onSwitchToRegister }: LoginPageProps) {
  const [phone, setPhone] = useState(TEST_STAFF_PHONE);
  const [password, setPassword] = useState(TEST_STAFF_PASSWORD);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureDefaultRoleDemosExist();
  }, []);

  const loginWithCredentials = (phoneVal: string, passwordVal: string) => {
    setError(null);
    setPhone(phoneVal);
    setPassword(passwordVal);
    const digits = normalizePhoneDigits(phoneVal);
    if (!isValidPhoneDigits(digits)) {
      setError("Telefon raqamini to'liq kiriting (masalan: +998 90 111 22 33).");
      return;
    }
    setLoading(true);
    try {
      loginLocalStaff(phoneVal, passwordVal);
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'user-not-found' || code === 'wrong-password') {
        setError("Telefon yoki parol noto'g'ri.");
      } else {
        setError("Kirishda xatolik. Qayta urinib ko'ring.");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDemoRoleClick = (phoneVal: string, passwordVal: string) => {
    loginWithCredentials(phoneVal, passwordVal);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const digits = normalizePhoneDigits(phone);
    if (!isValidPhoneDigits(digits)) {
      setError("Telefon raqamini to'liq kiriting (masalan: +998 90 111 22 33).");
      return;
    }
    setLoading(true);
    try {
      loginLocalStaff(phone, password);
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'user-not-found' || code === 'wrong-password') {
        setError("Telefon yoki parol noto'g'ri. Avval «Ro'yxatdan o'tish» orqali hisob yarating.");
      } else {
        setError("Kirishda xatolik. Qayta urinib ko'ring.");
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <div className="ios-glass rounded-[2rem] border border-white/60 shadow-xl p-8 md:p-10">
        <div className="text-center mb-8">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="mx-auto w-16 h-16 rounded-2xl object-cover border border-white/70 shadow-lg mb-4 bg-white"
          />
          <h1 className="text-2xl font-bold text-black/90 tracking-tight">iMentor tizimiga kirish</h1>
          <p className="text-[13px] text-black/50 mt-2 font-medium">
            iMentor uchun telefon raqam va parol
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-black/55 uppercase tracking-wide">Telefon raqam</label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3.5 pl-12 pr-4 text-[15px] font-medium text-black/90 outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="+998901112233"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-black/55 uppercase tracking-wide">Parol</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3.5 pl-12 pr-4 text-[15px] font-medium text-black/90 outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="Parol"
              />
            </div>
          </div>

          <p className="text-[11px] text-black/45 leading-relaxed bg-black/[0.03] rounded-xl px-3 py-2 border border-black/5">
            <span className="font-semibold text-black/55">Yangi hisob:</span> birinchi marta{' '}
            <button type="button" onClick={onSwitchToRegister} className="text-blue-600 font-semibold underline-offset-2 hover:underline">
              Ro‘yxatdan o‘tish
            </button>{' '}
            — ro‘yxatdan o‘tishda <span className="font-semibold text-black/55">hodim</span> yoki{' '}
            <span className="font-semibold text-black/55">startuper</span> rolini tanlaysiz.
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-[15px] font-semibold text-white shadow-md shadow-blue-600/25 transition hover:bg-blue-500 disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            Kirish
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-black/10 space-y-3">
          <p className="text-[11px] font-semibold text-black/45 uppercase tracking-wide text-center">
            Demo kirish (ustiga bosing — forma to‘ldiriladi va tizimga kiriladi)
          </p>
          <div className="grid gap-2">
            {DEMO_ROLE_LOGINS.map((demo) => {
              const Icon =
                demo.role === 'admin'
                  ? Shield
                  : demo.role === 'hodim'
                    ? BriefcaseMedical
                    : demo.role === 'startuper'
                      ? Rocket
                      : Languages;
              return (
                <button
                  key={demo.role}
                  type="button"
                  onClick={() => handleDemoRoleClick(demo.phone, demo.password)}
                  disabled={loading}
                  className="flex items-center gap-3 w-full text-left rounded-xl border border-black/10 bg-white/80 hover:bg-white hover:border-blue-300/60 px-3 py-2.5 transition shadow-sm disabled:opacity-60"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-600/10 text-blue-700 flex items-center justify-center shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-black/90">{demo.title}</p>
                    <p className="text-[11px] text-black/45 truncate">{demo.subtitle}</p>
                    <p className="text-[10px] text-black/35 font-mono mt-0.5">
                      {demo.phone} · {demo.password}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <p className="mt-6 text-center text-[13px] text-black/50">
          Hisobingiz yo‘qmi?{' '}
          <button type="button" onClick={onSwitchToRegister} className="font-semibold text-blue-600 hover:underline">
            Ro‘yxatdan o‘tish
          </button>
        </p>
      </div>
    </motion.div>
  );
}
