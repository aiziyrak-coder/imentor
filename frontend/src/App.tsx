/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, createContext, useContext, useRef } from 'react';
import { 
  LayoutDashboard, 
  Presentation, 
  Languages, 
  Menu, 
  X,
  Search,
  Bell,
  UserCircle,
  BriefcaseMedical,
  LogOut,
  BookOpen,
  ClipboardList,
  FileText,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  getCurrentLocalUser,
  logoutLocalStaff,
  subscribeLocalAuth,
  touchCurrentUserActivityIfNeeded,
  normalizeUserRole,
  type LocalStaffUser,
  type UserRole,
} from './utils/localStaffAuth';
import { clearBackendAuthTokens } from './utils/backendAuth';
import {
  type AppLanguage,
  getAppLanguage,
  setAppLanguage as persistAppLanguage,
  languageLabel,
} from './i18n/language';
import { type AppNotificationEventDetail } from './utils/notifications';

// Components
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import PresentationBuilder from './components/PresentationBuilder';
import CaseStudies from './components/CaseStudies';
import Translator from './components/Translator';
import UserProfile from './components/UserProfile';
import SyllabusView from './components/SyllabusView';
import TestQuestions from './components/TestQuestions';
import LectureNotes from './components/LectureNotes';
import AdminDashboardHome from './components/admin/AdminDashboardHome';
import AdminStaffManagement from './components/admin/AdminStaffManagement';
import AdminCasesLibrary from './components/admin/AdminCasesLibrary';
import AdminTestsLibrary from './components/admin/AdminTestsLibrary';

type View =
  | 'admin-dashboard'
  | 'admin-staff'
  | 'admin-cases'
  | 'admin-tests'
  | 'syllabus'
  | 'profile'
  | 'presentation'
  | 'cases'
  | 'tests'
  | 'translator'
  | 'lectures';

type NavItemDef = { id: View; label: string; icon: LucideIcon };

/** Hodim: dars kontenti + keys/test yaratish (bazaga yoziladi) */
const HODIM_NAV: NavItemDef[] = [
  { id: 'syllabus', label: 'Syllabus (Mavzu tanlash)', icon: BookOpen },
  { id: 'lectures', label: "Ma'ruza matni", icon: FileText },
  { id: 'presentation', label: 'Taqdimotlar', icon: Presentation },
  { id: 'cases', label: 'Keys yaratish', icon: BriefcaseMedical },
  { id: 'tests', label: 'Test yaratish', icon: ClipboardList },
  { id: 'profile', label: 'Profil', icon: UserCircle },
];

/** Administrator: faqat nazorat va bazalar (dars modullari yo‘q) */
const ADMIN_NAV: NavItemDef[] = [
  { id: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'admin-staff', label: 'Hodimlar', icon: Users },
  { id: 'admin-cases', label: 'Keys bazasi', icon: BriefcaseMedical },
  { id: 'admin-tests', label: 'Test bazasi', icon: ClipboardList },
  { id: 'profile', label: 'Profil', icon: UserCircle },
];

const TARJIMON_NAV: NavItemDef[] = [
  { id: 'translator', label: 'Tarjima', icon: Languages },
  { id: 'profile', label: 'Profil', icon: UserCircle },
];

function navItemsForRole(role: UserRole): NavItemDef[] {
  switch (role) {
    case 'admin':
      return ADMIN_NAV;
    case 'hodim':
      return HODIM_NAV;
    case 'tarjimon':
      return TARJIMON_NAV;
    default:
      return HODIM_NAV;
  }
}

export interface SyllabusTopic {
  id: string; // M1, A1, etc.
  title: string;
  type: 'lecture' | 'practical';
}

const LECTURE_DRAFT_STORAGE_KEY = 'imentor-lecture-draft-v1';

function readStoredLectureDraft(): string {
  try {
    return localStorage.getItem(LECTURE_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export const GlobalTopicContext = createContext<SyllabusTopic | null>(null);
export const GlobalLectureContext = createContext<{content: string, setContent: (c: string) => void}>({content: '', setContent: () => {}});
export const AppLanguageContext = createContext<{
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}>({
  language: 'uz',
  setLanguage: () => {},
});

type AuthScreen = 'login' | 'register';
type AppNotification = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  level?: 'info' | 'success' | 'warning' | 'error';
};

const NOTIFICATIONS_STORAGE_KEY = 'imentor-notifications-v1';

function readStoredNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [activeView, setActiveView] = useState<View>('syllabus');
  const [mountedViews, setMountedViews] = useState<View[]>(['syllabus']);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<LocalStaffUser | null>(() => getCurrentLocalUser());
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [selectedTopic, setSelectedTopic] = useState<SyllabusTopic | null>(null);
  const [latestLectureContent, setLatestLectureContent] = useState(readStoredLectureDraft);
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());
  const [notifications, setNotifications] = useState<AppNotification[]>(readStoredNotifications);
  const [isNotificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsPanelRef = useRef<HTMLDivElement | null>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement | null>(null);

  const setLectureContent = useCallback((c: string) => {
    setLatestLectureContent(c);
    try {
      localStorage.setItem(LECTURE_DRAFT_STORAGE_KEY, c);
    } catch {
      /* ignore quota */
    }
  }, []);

  const addNotification = useCallback((title: string, body: string, level: AppNotification['level'] = 'info') => {
    const next: AppNotification = {
      id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title,
      body,
      createdAt: Date.now(),
      read: false,
      level,
    };
    setNotifications((prev) => [next, ...prev].slice(0, 80));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  useEffect(() => {
    persistAppLanguage(language);
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
    } catch {
      /* ignore quota */
    }
  }, [notifications]);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const custom = event as CustomEvent<AppNotificationEventDetail>;
      const detail = custom.detail;
      if (!detail?.title || !detail?.body) return;
      addNotification(detail.title, detail.body, detail.level);
    };
    window.addEventListener('app:notify', onNotify as EventListener);
    return () => window.removeEventListener('app:notify', onNotify as EventListener);
  }, [addNotification]);

  useEffect(() => {
    if (!isNotificationsOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        notificationsPanelRef.current?.contains(target) ||
        notificationsButtonRef.current?.contains(target)
      ) {
        return;
      }
      setNotificationsOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    const unsub = subscribeLocalAuth(() => {
      const u = getCurrentLocalUser();
      setUser(u);
      if (!u) setAuthScreen('login');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    addNotification('Xush kelibsiz', `${user.displayName || 'Foydalanuvchi'}, tizimga muvaffaqiyatli kirdingiz.`, 'success');
  }, [user?.uid, user?.displayName, addNotification]);

  /** Sessiya bilan kirganda va oynaga qaytishda oxirgi faollik vaqtini yangilash */
  useEffect(() => {
    if (!user) return;
    touchCurrentUserActivityIfNeeded();
    const onFocus = () => touchCurrentUserActivityIfNeeded();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') touchCurrentUserActivityIfNeeded();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.uid]);

  const handleLogout = async () => {
    clearBackendAuthTokens();
    logoutLocalStaff();
  };

  const userRole = user ? normalizeUserRole(user) : null;
  const navItems = useMemo(() => (userRole ? navItemsForRole(userRole) : []), [userRole]);

  useEffect(() => {
    if (!user || !userRole) return;
    const allowed = navItemsForRole(userRole).map((i) => i.id);
    setActiveView((current) => (allowed.includes(current) ? current : allowed[0]));
  }, [user?.uid, user?.role, userRole]);

  useEffect(() => {
    if (!user || !userRole) return;
    const allowed = new Set(navItemsForRole(userRole).map((i) => i.id));
    setMountedViews((prev) => {
      const filtered = prev.filter((v) => allowed.has(v));
      if (allowed.has(activeView) && !filtered.includes(activeView)) filtered.push(activeView);
      if (filtered.length === 0) filtered.push(navItemsForRole(userRole)[0].id);
      return filtered;
    });
  }, [activeView, user?.uid, userRole]);

  const handleSelectTopic = (topic: SyllabusTopic) => {
    setSelectedTopic(topic);
    setActiveView('lectures');
    addNotification('Mavzu tanlandi', `${topic.id}: ${topic.title}`);
  };

  const renderContent = (view: View) => {
    switch (view) {
      case 'admin-dashboard':
        return <AdminDashboardHome />;
      case 'admin-staff':
        return <AdminStaffManagement />;
      case 'admin-cases':
        return <AdminCasesLibrary />;
      case 'admin-tests':
        return <AdminTestsLibrary />;
      case 'syllabus':
        return <SyllabusView onSelectTopic={handleSelectTopic} />;
      case 'lectures':
        return <LectureNotes />;
      case 'profile':
        return <UserProfile />;
      case 'presentation':
        return <PresentationBuilder />;
      case 'cases':
        return <CaseStudies />;
      case 'tests':
        return <TestQuestions />;
      case 'translator':
        return <Translator />;
      default:
        return <SyllabusView onSelectTopic={handleSelectTopic} />;
    }
  };

  const authShell = (
    <div className="flex h-screen w-full relative overflow-hidden text-[#1c1c1e]">
      <div className="absolute inset-0 futuristic-gradient opacity-95" />
      <div className="absolute top-[-10%] left-[-8%] w-[35%] h-[45%] bg-cyan-100/60 rounded-full blur-[120px] pointer-events-none orb-float" />
      <div className="absolute bottom-[-18%] right-[-8%] w-[42%] h-[55%] bg-emerald-100/55 rounded-full blur-[140px] pointer-events-none orb-float" />

      <div className="relative z-10 w-full h-full overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] h-full">
          <section className="relative p-8 md:p-10 lg:p-12 text-[#063545] overflow-hidden">
            <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/15 blur-2xl orb-float" />
            <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-emerald-100/30 blur-3xl orb-float" />
            <div className="relative z-10 h-full flex flex-col">
              <div className="flex flex-col gap-2">
                <h1 className="text-5xl font-black tracking-tight text-[#083047]">iMentor</h1>
                <p className="text-[#0b425e]/80 text-base font-semibold">AI Medical Education Platform</p>
              </div>

              <div className="mt-10 space-y-5 max-w-2xl">
                <h2 className="text-3xl md:text-4xl leading-tight font-extrabold text-[#083047]">
                  Zamonaviy tibbiy ta&apos;lim uchun aqlli platforma
                </h2>
                <div className="space-y-3 text-[#0b425e]/85 leading-relaxed text-[15px] md:text-base">
                  <p>
                    iMentor — oliy tibbiy ta&apos;lim muassasalari uchun yaratilgan yagona raqamli o&apos;quv-ekotizim bo&apos;lib,
                    o&apos;qituvchi va talabalar ish jarayonini sun&apos;iy intellekt yordamida tezlashtiradi. Platforma syllabus
                    asosida mavzularni avtomatik ajratadi, o&apos;qituvchi uchun ma&apos;ruza matni tayyorlaydi, darsga mos
                    taqdimot ishlab chiqadi va klinik tafakkurni rivojlantiruvchi keys hamda testlar yaratadi.
                  </p>
                  <p>
                    Tizimda kontentni saqlash, qayta ochish, tahrirlash, PDF/PPT formatlarda yuklab olish va
                    dars jarayonida to&apos;liq ekranda namoyish etish imkoniyatlari mavjud. Syllabus, ma&apos;ruza,
                    taqdimot, test va case modullari bir-biri bilan uzviy bog&apos;langan: bir bo&apos;limda tayyorlangan
                    material keyingi bo&apos;limlarda avtomatik ishlatiladi.
                  </p>
                  <p>
                    iMentor ko&apos;p tilli muhitni qo&apos;llab-quvvatlaydi (O&apos;zbek, Rus, English), shu sabab mahalliy va
                    xorijiy talabalar bilan ishlashda bir xil qulaylik beradi. Platforma interfeysi sodda, tezkor,
                    zamonaviy va tibbiy ta&apos;lim ehtiyojlariga mos ravishda ishlab chiqilgan.
                  </p>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                {[
                  { icon: BookOpen, text: 'Syllabus asosida mavzu tanlash' },
                  { icon: Presentation, text: 'Ma’ruza va slaydlarni AI bilan yaratish' },
                  { icon: ClipboardList, text: 'Klinik case va test generator' },
                  { icon: Languages, text: 'O‘zbek / Русский / English qo‘llab-quvvatlash' },
                ].map((item) => (
                  <div key={item.text} className="rounded-xl border border-[#0c5a7e]/20 bg-white/35 px-3 py-2 text-[13px] font-medium flex items-center gap-2 text-[#083047]">
                    <item.icon size={15} className="shrink-0 text-[#0c5a7e]" />
                    {item.text}
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-8 text-[12px] text-[#0b425e]/75">
                Farg&apos;ona jamoat salomatligi tibbiyot instituti uchun ishlab chiqilgan.
              </div>

              <div className="mt-4 pb-2 flex justify-center">
                <div className="rounded-full border border-white/70 bg-white/80 px-4 py-2 shadow-lg backdrop-blur-md">
                  <p className="text-[11px] leading-tight text-black/60 text-center whitespace-nowrap">
                    {'\u00A9'} 2026{' '}
                    <a
                      href="https://fjsti.uz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-700 hover:text-blue-600 underline decoration-blue-300"
                    >
                      Ishlab chiqaruvchi: FJSTI inkubatsiya akseleratsiya markazi
                    </a>
                    {' '}•{' '}
                    <a
                      href="https://fjsti.uz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-emerald-700 hover:text-emerald-600 underline decoration-emerald-300"
                    >
                      Qo&apos;llab-quvvatlovchi: Farg&apos;ona jamoat salomatligi tibbiyot instituti
                    </a>
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="p-4 md:p-6 lg:p-8 flex items-center justify-center bg-white/80 backdrop-blur-xl h-full overflow-y-auto scrollbar-hide">
            <div className="w-full max-w-[560px]">
              {authScreen === 'login' ? (
                <LoginPage onSwitchToRegister={() => setAuthScreen('register')} />
              ) : (
                <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  const platformCredit = (
    <div className="w-full px-0 pb-0 print:hidden">
      <div className="w-full border-t border-white/70 bg-white/80 backdrop-blur-md shadow-[0_-6px_24px_rgba(0,0,0,0.05)]">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] md:text-[11px] leading-snug text-black/65">
            <span className="font-medium">{'\u00A9'} 2026 iMentor Platform</span>
            <a
              href="https://fjsti.uz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-700 hover:text-blue-600 underline decoration-blue-300"
            >
              Ishlab chiqaruvchi: FJSTI inkubatsiya akseleratsiya markazi
            </a>
            <a
              href="https://fjsti.uz"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-emerald-700 hover:text-emerald-600 underline decoration-emerald-300"
            >
              Qo&apos;llab-quvvatlovchi: Farg&apos;ona jamoat salomatligi tibbiyot instituti
            </a>
            <span className="font-medium text-violet-700">Patent raqami: IM-2026-PAT-001</span>
            <span className="font-medium text-slate-700">Litsenziyalangan: Medical EdTech Suite</span>
            <span className="font-medium text-cyan-700">Sertifikatlangan: ISO/IEC yo&apos;riqnomalari asosida</span>
          </div>
        </div>
      </div>
    </div>
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <AppLanguageContext.Provider value={{ language, setLanguage }}>
    <GlobalTopicContext.Provider value={selectedTopic}>
      <GlobalLectureContext.Provider value={{ content: latestLectureContent, setContent: setLectureContent }}>
      {!user ? (
        <>
          {authShell}
        </>
      ) : (
      <>
      <div className="flex flex-col h-screen w-full relative overflow-hidden bg-gradient-to-br from-[#eef6ff] via-[#f5f8ff] to-[#f3f0ff] text-[#1c1c1e] selection:bg-sky-500/30">
      
      {/* Background iOS Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-400/25 rounded-full blur-[120px] pointer-events-none orb-float" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-400/20 rounded-full blur-[140px] pointer-events-none orb-float" />
      <div className="absolute top-[20%] right-[10%] w-[30%] h-[40%] bg-cyan-300/20 rounded-full blur-[100px] pointer-events-none orb-float" />

      {/* Main Layout Container */}
      <div className="relative z-10 flex w-full flex-1 p-4 gap-4 min-h-0">
        
        {/* Floating Sidebar */}
        <motion.aside 
          initial={false}
          animate={{ width: isSidebarOpen ? 280 : 88 }}
          className="ios-glass rounded-[2rem] flex flex-col z-50 shrink-0 overflow-hidden relative shadow-2xl pb-4 border border-white/60 print:hidden"
        >
          <div className="p-6 flex items-center justify-between pb-4">
            <div className={`flex items-center gap-3 overflow-hidden ${!isSidebarOpen && 'hidden'}`}>
              <img
                src="/imentor-logo.png"
                alt="iMentor"
                className="w-12 h-12 rounded-2xl object-cover shadow-lg border border-white/70 bg-white shrink-0"
              />
              <div className="flex flex-col min-w-max">
                <span className="font-semibold text-[15px] tracking-tight leading-tight text-black/90">
                  iMentor
                </span>
                <span className="text-[11px] text-black/50 font-medium tracking-wide">iMentor Platform</span>
              </div>
            </div>
            <button 
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              className="w-10 h-10 ios-glass-btn border border-black/5 flex justify-center items-center rounded-xl text-black/60 mx-auto bg-white/40 hover:bg-white/60 backdrop-blur-md transition-all shadow-sm shrink-0"
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>

          <div className={`px-6 mb-2 mt-2 transition-opacity duration-200 ${!isSidebarOpen ? 'opacity-0 h-0 hidden' : 'opacity-100'}`}>
            <p className="text-[11px] font-semibold text-black/40 uppercase tracking-widest">Asosiy Menyu</p>
          </div>

          <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto scrollbar-hide">
            {navItems.map((item) => (
              <button
                  key={item.id}
                  onClick={() => setActiveView(item.id as View)}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 text-[15px] group
                    ${activeView === item.id 
                      ? 'bg-blue-600 shadow-md shadow-blue-600/20 text-white font-semibold' 
                      : 'text-black/60 hover:bg-white/60 hover:shadow-sm font-medium'}`}
                >
                  <item.icon size={22} className={`shrink-0 ${activeView === item.id ? 'text-white' : 'text-black/40 group-hover:text-blue-500 transition-colors'}`} strokeWidth={activeView === item.id ? 2.5 : 2} />
                  {isSidebarOpen && <span className="truncate">{item.label}</span>}
                </button>
            ))}
          </nav>

          <div className="px-4 mt-auto space-y-3">
             <button
                onClick={handleLogout}
                className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 text-[15px] text-rose-500 hover:bg-rose-500/10 hover:shadow-sm font-medium group`}
              >
                <LogOut size={22} className="shrink-0 text-rose-400 group-hover:text-rose-500 transition-colors" strokeWidth={2} />
                {isSidebarOpen && <span className="truncate">Chiqish</span>}
              </button>
          </div>
        </motion.aside>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col gap-4 overflow-hidden relative">
          {/* Header */}
          <header className="ios-glass h-20 rounded-[2rem] flex items-center justify-between px-8 shrink-0 z-40 shadow-sm border border-white/60 print:hidden">
            <div className="flex items-center space-x-6">
              <div className="w-11 h-11 bg-white/50 border border-white/60 shadow-sm rounded-2xl flex items-center justify-center text-black/50 cursor-pointer hover:bg-white/80 transition-colors">
                <Search size={20} />
              </div>
              <div className="flex-col hidden sm:flex border-l border-black/10 pl-6 space-y-0.5">
                <h1 className="text-[16px] font-semibold tracking-tight text-black/90">iMentor Platform</h1>
                <p className="text-[12px] text-black/50 font-medium tracking-wide">
                  {userRole === 'admin' ? 'Markaziy nazorat paneli' : 'Tizim holati va monitoring'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                className="h-11 rounded-xl border border-white/60 bg-white/70 px-3 text-[12px] font-semibold text-black/70 outline-none"
                aria-label="Platform language"
              >
                <option value="uz">{languageLabel('uz')}</option>
                <option value="ru">{languageLabel('ru')}</option>
                <option value="en">{languageLabel('en')}</option>
              </select>
              <button
                ref={notificationsButtonRef}
                onClick={() => setNotificationsOpen((v) => !v)}
                className="relative w-11 h-11 bg-white/50 border border-white/60 shadow-sm rounded-2xl flex items-center justify-center text-black/50 cursor-pointer hover:bg-white/80 transition-colors"
              >
                <Bell size={20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-rose-500 rounded-full border border-white text-[10px] leading-5 text-white font-bold text-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              <div className="w-px h-8 bg-black/10"></div>
              <div className="flex items-center gap-4 cursor-pointer group" onClick={() => setActiveView('profile')}>
                <div className="flex-col items-end hidden md:flex">
                  <span className="text-[14px] font-semibold text-black/80 group-hover:text-blue-600 transition-colors">{user.displayName || 'Xodim'}</span>
                  <span className="text-[11px] text-black/40 font-medium mt-0.5">
                    {userRole === 'admin'
                      ? 'Administrator'
                      : userRole === 'tarjimon'
                        ? 'Tarjimon'
                        : 'Hodim'}
                  </span>
                </div>
                <div className="w-12 h-12 rounded-[16px] bg-gradient-to-tr from-blue-400 to-indigo-500 p-[2px] shadow-md group-hover:shadow-lg transition-all group-hover:scale-105">
                  <div className="w-full h-full rounded-[14px] overflow-hidden bg-white flex items-center justify-center">
                    {user?.photoURL ? (
                      <img src={user.photoURL} alt="User" className="w-full h-full object-cover" />
                    ) : (
                      <UserCircle size={24} className="text-black/30" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {isNotificationsOpen && (
            <div
              ref={notificationsPanelRef}
              className="absolute top-24 right-8 z-[80] w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/70 bg-white/90 shadow-2xl backdrop-blur-md overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-black/80">Bildirishnomalar</h3>
                <button
                  onClick={markAllNotificationsRead}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-500"
                >
                  Barchasini o&apos;qildi qilish
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-[12px] text-black/45 text-center">
                    Hozircha bildirishnoma yo&apos;q.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() =>
                        setNotifications((prev) =>
                          prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
                        )
                      }
                      className={`px-4 py-3 border-b border-black/5 cursor-pointer ${
                        n.read
                          ? 'bg-white/30'
                          : n.level === 'error'
                            ? 'bg-rose-50/70'
                            : n.level === 'warning'
                              ? 'bg-amber-50/70'
                              : n.level === 'success'
                                ? 'bg-emerald-50/70'
                                : 'bg-blue-50/60'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-black/80">{n.title}</p>
                          <p className="text-[12px] text-black/60 mt-0.5 break-words">{n.body}</p>
                          <p className="text-[10px] text-black/35 mt-1">
                            {new Date(n.createdAt).toLocaleString('uz-UZ')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Main View Port */}
          <div className="flex-1 overflow-y-auto scrollbar-hide rounded-[2rem]">
            {mountedViews.map((view) => {
              const isActive = activeView === view;
              return (
                <motion.div
                  key={view}
                  initial={isActive ? { opacity: 0, scale: 0.98, y: 10 } : false}
                  animate={isActive ? { opacity: 1, scale: 1, y: 0 } : false}
                  transition={isActive ? { duration: 0.25, ease: [0.22, 1, 0.36, 1] } : undefined}
                  className={isActive ? 'h-full' : 'hidden'}
                >
                  {renderContent(view)}
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
      {platformCredit}
    </div>
      </>
      )}
      </GlobalLectureContext.Provider>
    </GlobalTopicContext.Provider>
    </AppLanguageContext.Provider>
  );
}





