import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Camera,
  LogOut,
  Save
} from 'lucide-react';
import {
  getCurrentLocalUser,
  logoutLocalStaff,
  updateCurrentLocalUser,
  normalizeUserRole,
  type LocalStaffUser,
} from '../utils/localStaffAuth';

export default function UserProfile() {
  const [user, setUser] = useState<LocalStaffUser | null>(() => getCurrentLocalUser());
  
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loadingPassword, setLoadingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);

  const isGoogleAuth = false;

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setPhone(user.phoneDisplay);
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setLoadingProfile(true);
    setProfileMessage(null);
    try {
      const parts = displayName.trim().split(/\s+/);
      const firstName = parts[0] || user.firstName;
      const lastName = parts.slice(1).join(' ') || user.lastName;
      const updated = updateCurrentLocalUser({
        displayName: displayName.trim(),
        firstName,
        lastName,
        phoneDisplay: phone.trim(),
      });
      setUser(updated);
      setProfileMessage({ text: "Profil muvaffaqiyatli yangilandi!", type: 'success' });
      
      setTimeout(() => setProfileMessage(null), 3000);
    } catch (err) {
      console.error(err);
      setProfileMessage({ text: "Xatolik yuz berdi. Iltimos qayta urinib ko'ring.", type: 'error' });
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ text: "Yangi parollar mos kelmadi!", type: 'error' });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage({ text: "Parol kamida 6 belgidan iborat bo'lishi kerak!", type: 'error' });
      return;
    }

    setLoadingPassword(true);
    setPasswordMessage(null);
    
    try {
      if (currentPassword !== user.password) {
        setPasswordMessage({ text: "Joriy parol noto'g'ri kiritildi.", type: 'error' });
      } else {
        const updated = updateCurrentLocalUser({ password: newPassword });
        setUser(updated);
        setPasswordMessage({ text: "Parol muvaffaqiyatli o'zgartirildi!", type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err: unknown) {
      console.error(err);
      setPasswordMessage({ text: "Parolni yangilashda xatolik.", type: 'error' });
    } finally {
      setLoadingPassword(false);
    }
  };

  const handleLogout = async () => {
    logoutLocalStaff();
  };

  const role = user ? normalizeUserRole(user) : 'hodim';
  const roleLabel =
    role === 'admin' ? 'Administrator' : role === 'tarjimon' ? 'Tarjimon' : 'Hodim';

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-10 flex flex-col items-center h-full sm:p-4">
      {/* Header Profile Section */}
      <div className="ios-glass p-8 rounded-[2rem] shadow-sm relative overflow-hidden w-full max-w-4xl border border-white/60">
        <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[150%] bg-gradient-to-l from-blue-500/20 to-transparent blur-3xl pointer-events-none" />
        
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8 relative z-10 w-full">
          {/* Avatar container */}
          <div className="relative group shrink-0">
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-[2rem] p-1.5 bg-gradient-to-tr from-sky-400 via-blue-500 to-indigo-500 shadow-xl shadow-blue-500/30 transition-transform duration-500 ease-out relative">
              <div className="w-full h-full rounded-[1.75rem] overflow-hidden bg-white flex items-center justify-center">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User size={64} className="text-black/20" />
                )}
              </div>
              <button className="absolute -bottom-3 -right-3 w-12 h-12 bg-white rounded-2xl shadow-lg border border-black/5 flex flex-col items-center justify-center text-blue-600 hover:text-blue-700 hover:scale-105 transition-all">
                <Camera size={20} />
              </button>
            </div>
          </div>

          <div className="flex-1 text-center md:text-left pt-2 w-full flex flex-col h-full justify-between">
            <div>
                <div className="flex flex-wrap justify-center md:justify-start items-center gap-3 mb-2">
                <h1 className="text-2xl md:text-3xl font-bold text-black/90 tracking-tight">{user?.displayName || "Foydalanuvchi"}</h1>
                <span className="px-3 py-1 bg-sky-500/10 border border-sky-500/20 text-sky-700 text-[12px] font-semibold rounded-lg">
                  Rol: {roleLabel}
                </span>
                <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-[12px] font-semibold rounded-lg flex items-center gap-1.5">
                  <ShieldCheck size={14} /> Lokal rejim
                </span>
                </div>
                <p className="text-[14px] font-medium text-black/55 mb-2">
                  {user?.faculty && (
                    <>
                      <span className="text-black/40">Fakultet:</span> {user.faculty}
                      <br />
                      <span className="text-black/40">Kafedra:</span> {user.department}
                      <br />
                      <span className="text-black/40">Yo&apos;nalish:</span> {user.direction}
                    </>
                  )}
                </p>
                <p className="text-[12px] font-mono text-black/40 mb-6 break-all">
                  Tizim ID: {user?.email || '—'}
                </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
               <button 
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl font-semibold transition-colors border border-rose-100"
               >
                 <LogOut size={18} />
                 Tizimdan chiqish
               </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full max-w-4xl">
         
         {/* Profile Update Form */}
         <div className="space-y-6">
            <div className="ios-glass p-6 sm:p-8 rounded-[2rem] shadow-sm border border-white/60">
                <h3 className="text-xl font-bold text-black/80 flex items-center gap-2 mb-6">
                    <User size={22} className="text-blue-500" /> Shaxsiy Ma'lumotlar
                </h3>
                <form onSubmit={handleUpdateProfile} className="space-y-5">
                    
                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-black/60 px-1">Ism-sharif</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40"><User size={18} /></span>
                            <input 
                                type="text"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                className="w-full bg-white/60 border border-black/10 rounded-xl py-3 pl-11 pr-4 text-black/80 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white transition-all"
                                placeholder="To'liq ismingiz"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-black/60 px-1">Telefon raqam</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40"><Phone size={18} /></span>
                            <input 
                                type="text"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                className="w-full bg-white/60 border border-black/10 rounded-xl py-3 pl-11 pr-4 text-black/80 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white transition-all"
                                placeholder="+998 90 123 45 67"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-semibold text-black/60 px-1">Ichki login (telefon asosida)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/40"><Mail size={18} /></span>
                            <input 
                                type="email"
                                value={user?.email || ''}
                                disabled
                                className="w-full bg-black/5 border border-black/5 rounded-xl py-3 pl-11 pr-4 text-black/50 font-medium cursor-not-allowed text-xs"
                            />
                        </div>
                        <p className="text-xs text-black/40 px-1 mt-1">Kirish telefon raqam orqali; bu maydon faqat tizim identifikatori.</p>
                    </div>

                    {profileMessage && (
                        <div className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${profileMessage.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                            {profileMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                            {profileMessage.text}
                        </div>
                    )}

                    <button 
                        type="submit"
                        disabled={loadingProfile}
                        className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                        {loadingProfile ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        O'zgarishlarni saqlash
                    </button>
                </form>
            </div>
         </div>

         {/* Change Password Form */}
         <div className="space-y-6">
            <div className="ios-glass p-6 sm:p-8 rounded-[2rem] shadow-sm border border-white/60 h-full">
                <h3 className="text-xl font-bold text-black/80 flex items-center gap-2 mb-6">
                    <Lock size={22} className="text-violet-500" /> Parolni O'zgartirish
                </h3>
                
                {isGoogleAuth ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center bg-violet-50/50 rounded-2xl border border-violet-100 p-6">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 text-violet-500">
                            <Lock size={32} />
                        </div>
                        <h4 className="font-semibold text-black/80 text-lg mb-2">Google hisobi ulangan</h4>
                        <p className="text-sm text-black/50">
                            Siz tizimga Google orqali kirgansiz. Parolingizni to'g'ridan-to'g'ri tizim orqali o'zgartirish mumkin emas.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleChangePassword} className="space-y-5">
                    
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-black/60 px-1">Joriy parol</label>
                            <input 
                                type="password"
                                value={currentPassword}
                                onChange={e => setCurrentPassword(e.target.value)}
                                required
                                className="w-full bg-white/60 border border-black/10 rounded-xl py-3 px-4 text-black/80 font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:bg-white transition-all"
                                placeholder={"Joriy parolingizni kiriting"}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-black/60 px-1">Yangi parol</label>
                            <input 
                                type="password"
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full bg-white/60 border border-black/10 rounded-xl py-3 px-4 text-black/80 font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:bg-white transition-all"
                                placeholder={"Kamida 6 belgi"}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-black/60 px-1">Yangi parolni tasdiqlang</label>
                            <input 
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                minLength={6}
                                className="w-full bg-white/60 border border-black/10 rounded-xl py-3 px-4 text-black/80 font-medium focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:bg-white transition-all"
                                placeholder={"Yangi parolni qayta kiriting"}
                            />
                        </div>

                        {passwordMessage && (
                            <div className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${passwordMessage.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                                {passwordMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                                {passwordMessage.text}
                            </div>
                        )}

                        <button 
                            type="submit"
                            disabled={loadingPassword}
                            className="w-full mt-2 bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                            {loadingPassword ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
                            Parolni yangilash
                        </button>
                    </form>
                )}
            </div>
         </div>
      </div>
    </div>
  );
}
