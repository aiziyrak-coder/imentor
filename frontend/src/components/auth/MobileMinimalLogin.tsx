import React, { useState } from 'react';
import { Loader2, Lock, Phone } from 'lucide-react';
import {
  isValidPhoneDigits,
  loginLocalStaff,
  normalizePhoneDigits,
} from '../../utils/localStaffAuth';
import { getBackendAccessToken } from '../../utils/backendAuth';

export default function MobileMinimalLogin() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const digits = normalizePhoneDigits(phone);
    if (!isValidPhoneDigits(digits)) {
      setError("Telefon raqamini to'liq kiriting");
      return;
    }
    if (!password.trim()) {
      setError('Parolni kiriting');
      return;
    }
    setLoading(true);
    try {
      const u = loginLocalStaff(phone, password);
      void getBackendAccessToken();
    } catch {
      setError("Telefon yoki parol noto'g'ri");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col justify-center px-6 py-10 bg-[#f8fafc]"
      style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-[340px] mx-auto">
        <div className="flex justify-center mb-10">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="w-20 h-20 rounded-[22px] object-cover shadow-lg border border-white"
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Telefon raqam"
              className="w-full h-14 rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-[17px] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Parol"
              className="w-full h-14 rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-[17px] text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>

          {error && (
            <p className="text-center text-[14px] text-rose-600 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-14 rounded-2xl bg-sky-600 text-white text-[17px] font-semibold shadow-lg shadow-sky-600/25 active:scale-[0.98] transition disabled:opacity-60 flex items-center justify-center"
          >
            {loading ? <Loader2 className="animate-spin" size={24} /> : 'Kirish'}
          </button>
        </form>
      </div>
    </div>
  );
}
