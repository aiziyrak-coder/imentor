import React, { useState } from 'react';
import { Loader2, AlertCircle, Phone, Lock, Building2, Users, BookOpen } from 'lucide-react';
import { motion } from 'motion/react';
import {
  isValidPhoneDigits,
  registerLocalStaff,
  normalizePhoneDigits,
  TEST_STAFF_PHONE,
  TEST_STAFF_PASSWORD,
} from '../../utils/localStaffAuth';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

export default function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const [phone, setPhone] = useState(TEST_STAFF_PHONE);
  const [password, setPassword] = useState(TEST_STAFF_PASSWORD);
  const [confirmPassword, setConfirmPassword] = useState(TEST_STAFF_PASSWORD);
  const [firstName, setFirstName] = useState('Test');
  const [lastName, setLastName] = useState('Hodim');
  const [faculty, setFaculty] = useState('Tibbiyot fakulteti');
  const [department, setDepartment] = useState('Ichki kasalliklar kafedrasi');
  const [direction, setDirection] = useState("Terapiya yo'nalishi");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('Ism va familiyani kiriting.');
      return;
    }
    if (!faculty.trim() || !department.trim() || !direction.trim()) {
      setError('Fakultet, kafedra va yo‘nalishni to‘ldiring.');
      return;
    }

    const digits = normalizePhoneDigits(phone);
    if (!isValidPhoneDigits(digits)) {
      setError("Telefon raqamini to'liq kiriting (O‘zbekiston: +998...).");
      return;
    }
    if (password.length < 6) {
      setError('Parol kamida 6 belgi bo‘lsin.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Parollar mos emas.');
      return;
    }
    setLoading(true);
    try {
      registerLocalStaff({
        phoneDisplay: phone.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        faculty: faculty.trim(),
        department: department.trim(),
        direction: direction.trim(),
      });
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'already-exists') {
        setError('Bu telefon raqam bilan allaqachon ro‘yxatdan o‘tilgan. «Kirish» sahifasiga o‘ting.');
      } else if (code === 'weak-password') {
        setError('Parol juda zaif.');
      } else {
        setError("Ro'yxatdan o'tishda xatolik. Qayta urinib ko'ring.");
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg"
    >
      <div className="ios-glass rounded-[2rem] border border-white/60 shadow-xl p-8 md:p-10 max-h-[90vh] overflow-y-auto scrollbar-hide">
        <div className="text-center mb-6">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="mx-auto w-16 h-16 rounded-2xl object-cover border border-white/70 shadow-lg mb-4 bg-white"
          />
          <h1 className="text-2xl font-bold text-black/90 tracking-tight">iMentor ro‘yxatdan o‘tish</h1>
          <p className="text-[13px] text-black/50 mt-2 font-medium">iMentor xodimlari uchun — telefon, parol va ish joyi</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">Ism</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                placeholder="Ism"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">Familiya</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                placeholder="Familiya"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55 flex items-center gap-1">
              <Building2 size={12} /> Fakultet
            </label>
            <input
              value={faculty}
              onChange={(e) => setFaculty(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              placeholder="Masalan: Pediatriya fakulteti"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55 flex items-center gap-1">
              <Users size={12} /> Kafedra
            </label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              placeholder="Masalan: Xirurgiya kafedrasi"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55 flex items-center gap-1">
              <BookOpen size={12} /> Yo‘nalish / mutaxassislik
            </label>
            <input
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white/70 px-4 py-3 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              placeholder="Masalan: Davolash ishi"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-black/55">Telefon raqam</label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white/70 py-3 pl-12 pr-4 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">Parol</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white/70 py-3 pl-12 pr-4 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-black/55">Parolni tasdiqlash</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-black/35" size={18} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white/70 py-3 pl-12 pr-4 text-[14px] font-medium outline-none focus:ring-2 focus:ring-emerald-500/35"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-700">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-[15px] font-semibold text-white shadow-md transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : null}
            Ro‘yxatdan o‘tish
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-black/50">
          Allaqachon hisobingiz bormi?{' '}
          <button type="button" onClick={onSwitchToLogin} className="font-semibold text-blue-600 hover:underline">
            Kirish
          </button>
        </p>
      </div>
    </motion.div>
  );
}
