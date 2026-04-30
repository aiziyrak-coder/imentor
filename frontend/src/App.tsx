/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
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

export default function App() {
  const [activeView, setActiveView] = useState<View>('syllabus');
  const [mountedViews, setMountedViews] = useState<View[]>(['syllabus']);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<LocalStaffUser | null>(() => getCurrentLocalUser());
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [selectedTopic, setSelectedTopic] = useState<SyllabusTopic | null>(null);
  const [latestLectureContent, setLatestLectureContent] = useState(readStoredLectureDraft);
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());

  const setLectureContent = useCallback((c: string) => {
    setLatestLectureContent(c);
    try {
      localStorage.setItem(LECTURE_DRAFT_STORAGE_KEY, c);
    } catch {
      /* ignore quota */
    }
  }, []);

  useEffect(() => {
    persistAppLanguage(language);
  }, [language]);

  useEffect(() => {
    const unsub = subscribeLocalAuth(() => {
      const u = getCurrentLocalUser();
      setUser(u);
      if (!u) setAuthScreen('login');
    });
    return () => unsub();
  }, []);

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
    <div className="flex min-h-screen w-full items-center justify-center relative overflow-hidden bg-[#f2f2f7] p-6 text-[#1c1c1e]">
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-400/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-400/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="mb-8 flex items-center gap-3">
          <img
            src="/imentor-logo.png"
            alt="iMentor"
            className="w-12 h-12 rounded-2xl object-cover shadow-lg border border-white/70 bg-white"
          />
          <div>
            <p className="font-semibold text-black/90">iMentor Platform</p>
            <p className="text-xs text-black/45">AI Medical Education</p>
          </div>
        </div>
        {authScreen === 'login' ? (
          <LoginPage onSwitchToRegister={() => setAuthScreen('register')} />
        ) : (
          <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />
        )}
      </div>
    </div>
  );

  return (
    <AppLanguageContext.Provider value={{ language, setLanguage }}>
    <GlobalTopicContext.Provider value={selectedTopic}>
      <GlobalLectureContext.Provider value={{ content: latestLectureContent, setContent: setLectureContent }}>
      {!user ? (
        authShell
      ) : (
      <div className="flex h-screen w-full relative overflow-hidden bg-[#f2f2f7] text-[#1c1c1e] selection:bg-sky-500/30">
      
      {/* Background iOS Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-400/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-400/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-[20%] right-[10%] w-[30%] h-[40%] bg-rose-400/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Layout Container */}
      <div className="relative z-10 flex w-full h-full p-4 gap-4">
        
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
                  {userRole === 'tarjimon'
                    ? 'Tarjimon portali'
                    : userRole === 'admin'
                      ? 'iMentor Admin'
                      : 'iMentor Staff'}
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
              <button className="relative w-11 h-11 bg-white/50 border border-white/60 shadow-sm rounded-2xl flex items-center justify-center text-black/50 cursor-pointer hover:bg-white/80 transition-colors">
                <Bell size={20} />
                <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-rose-500 rounded-full border border-white"></span>
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
    </div>
      )}
      </GlobalLectureContext.Provider>
    </GlobalTopicContext.Provider>
    </AppLanguageContext.Provider>
  );
}





