import React, { useState } from 'react';
import {
  BookOpen,
  BriefcaseMedical,
  ClipboardList,
  Languages,
  LogIn,
  Presentation,
  Sparkles,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { AppLanguage } from '../../i18n/language';
import { languageLabel } from '../../i18n/language';
import { translate } from '../../i18n/translations';
import LoginPage from '../auth/LoginPage';
import RegisterPage from '../auth/RegisterPage';
import DesktopHodimQrLogin from '../auth/DesktopHodimQrLogin';
import MobileMinimalLogin from '../auth/MobileMinimalLogin';
import { isDesktopBrowser } from '../../utils/deviceDetection';
import PublicContentCatalog from './PublicContentCatalog';

type AuthScreen = 'login' | 'register';

type Props = {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  isMobileDevice: boolean;
  desktopStaffLogin: boolean;
  setDesktopStaffLogin: (v: boolean) => void;
};

export default function PublicLandingPage({
  language,
  setLanguage,
  isMobileDevice,
  desktopStaffLogin,
  setDesktopStaffLogin,
}: Props) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');

  const scrollToCatalog = () => {
    document.getElementById('public-catalog')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#eef6fb] text-[#083047]">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-20 h-[420px] w-[420px] rounded-full bg-cyan-300/30 blur-[120px] orb-float" />
        <div className="absolute top-[20%] -right-24 h-[520px] w-[520px] rounded-full bg-emerald-200/35 blur-[140px] orb-float" />
        <div className="absolute bottom-[-10%] left-[20%] h-[380px] w-[380px] rounded-full bg-indigo-200/30 blur-[120px] orb-float" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/imentor-logo.png" alt="iMentor" className="h-11 w-11 rounded-2xl object-cover border border-white shadow-md shrink-0" />
            <div className="min-w-0">
              <p className="font-black text-lg tracking-tight truncate">iMentor</p>
              <p className="text-[11px] text-[#0b425e]/60 font-semibold truncate">
                {translate(language, 'publicLanding.brandSubtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              className="h-10 rounded-xl border border-black/10 bg-white px-2 text-[11px] font-semibold"
              aria-label={translate(language, 'shell.languageAria')}
            >
              <option value="uz">{languageLabel('uz')}</option>
              <option value="ru">{languageLabel('ru')}</option>
              <option value="en">{languageLabel('en')}</option>
            </select>
            <button
              type="button"
              onClick={scrollToCatalog}
              className="hidden sm:inline-flex h-10 items-center rounded-xl border border-[#0c5a7e]/20 bg-white px-3 text-[12px] font-semibold"
            >
              {translate(language, 'publicLanding.browseCatalog')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthOpen(true);
                setAuthScreen('login');
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#083047] px-4 text-[12px] font-bold text-white shadow-lg"
            >
              <LogIn size={15} /> {translate(language, 'publicLanding.login')}
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-6">
        <section className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 py-10 lg:py-16 items-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800">
              <Sparkles size={14} /> {translate(language, 'publicLanding.badge')}
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] tracking-tight text-[#083047]">
              {translate(language, 'publicLanding.heroTitle')}
            </h1>
            <p className="text-[16px] sm:text-[18px] leading-relaxed text-[#0b425e]/80 max-w-2xl">
              {translate(language, 'publicLanding.heroSubtitle')}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={scrollToCatalog}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 text-[14px] font-bold text-white shadow-xl hover:brightness-105"
              >
                <BookOpen size={18} /> {translate(language, 'publicLanding.openCatalog')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthOpen(true);
                  setAuthScreen('register');
                }}
                className="inline-flex items-center gap-2 rounded-2xl border border-[#0c5a7e]/25 bg-white/80 px-5 py-3 text-[14px] font-bold text-[#083047] shadow-sm"
              >
                {translate(language, 'publicLanding.staffAccess')}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl pt-2">
              {[
                { icon: BookOpen, text: translate(language, 'welcome.featureSyllabus') },
                { icon: Presentation, text: translate(language, 'welcome.featurePresentation') },
                { icon: ClipboardList, text: translate(language, 'welcome.featureCases') },
                { icon: Languages, text: translate(language, 'welcome.featureLanguages') },
              ].map((item) => (
                <div
                  key={item.text}
                  className="rounded-2xl border border-[#0c5a7e]/15 bg-white/55 px-3 py-2.5 text-[13px] font-medium flex items-center gap-2"
                >
                  <item.icon size={15} className="shrink-0 text-[#0c5a7e]" />
                  {item.text}
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative rounded-[2rem] border border-white/70 bg-white/60 backdrop-blur-xl p-6 sm:p-8 shadow-2xl overflow-hidden"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage: 'url(/imentor-logo.png)',
                backgroundSize: '180px',
                backgroundRepeat: 'repeat',
                backgroundPosition: 'center',
              }}
            />
            <div className="relative space-y-5">
              <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-[#0c5a7e]">
                {translate(language, 'publicLanding.openAccessTitle')}
              </p>
              <h2 className="text-2xl font-black leading-tight">{translate(language, 'publicCatalog.title')}</h2>
              <p className="text-[14px] text-[#0b425e]/75 leading-relaxed">
                {translate(language, 'publicLanding.openAccessBody')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
                  <BriefcaseMedical className="text-emerald-700 mb-2" size={22} />
                  <p className="text-[12px] font-bold text-emerald-900">{translate(language, 'catalog.kindCase')}</p>
                  <p className="text-[11px] text-emerald-800/70 mt-1">{translate(language, 'publicLanding.caseHint')}</p>
                </div>
                <div className="rounded-2xl bg-indigo-50 border border-indigo-200 p-4">
                  <ClipboardList className="text-indigo-700 mb-2" size={22} />
                  <p className="text-[12px] font-bold text-indigo-900">{translate(language, 'catalog.kindTest')}</p>
                  <p className="text-[11px] text-indigo-800/70 mt-1">{translate(language, 'publicLanding.testHint')}</p>
                </div>
              </div>
              <ul className="space-y-2 text-[12px] text-[#0b425e]/70">
                <li>• {translate(language, 'publicLanding.featureNoLogin')}</li>
                <li>• {translate(language, 'publicLanding.featureVerified')}</li>
                <li>• {translate(language, 'publicLanding.featureProtected')}</li>
              </ul>
            </div>
          </motion.div>
        </section>

        <div className="rounded-[2rem] border border-white/70 bg-white/50 backdrop-blur-xl shadow-xl overflow-hidden mb-2">
          <PublicContentCatalog language={language} embedded />
        </div>

        <footer className="py-10 text-center space-y-3">
          <p className="text-[12px] text-[#0b425e]/65">{translate(language, 'welcome.footerInstitute')}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-black/50">
            <span>{translate(language, 'footer.copyright')}</span>
            <a href="https://fjsti.uz" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline">
              {translate(language, 'footer.developer')}
            </a>
            <a href="https://fjsti.uz" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 underline">
              {translate(language, 'footer.supporter')}
            </a>
          </div>
        </footer>
      </main>

      <AnimatePresence>
        {authOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-[#083047]/40 backdrop-blur-sm p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              className="w-full sm:max-w-[560px] max-h-[92dvh] overflow-y-auto rounded-t-[2rem] sm:rounded-[2rem] bg-white shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/95 backdrop-blur px-5 py-4">
                <p className="font-bold text-[#083047]">{translate(language, 'publicLanding.authPanelTitle')}</p>
                <button type="button" onClick={() => setAuthOpen(false)} className="p-2 rounded-xl hover:bg-black/5">
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 sm:p-6">
                {isMobileDevice ? (
                  authScreen === 'login' ? (
                    <MobileMinimalLogin onSwitchToRegister={() => setAuthScreen('register')} />
                  ) : (
                    <RegisterPage onSwitchToLogin={() => setAuthScreen('login')} />
                  )
                ) : isDesktopBrowser() && !desktopStaffLogin ? (
                  <DesktopHodimQrLogin
                    onOtherRoles={() => setDesktopStaffLogin(true)}
                  />
                ) : authScreen === 'login' ? (
                  <LoginPage
                    onSwitchToRegister={() => setAuthScreen('register')}
                    onBackToQr={isDesktopBrowser() ? () => setDesktopStaffLogin(false) : undefined}
                  />
                ) : (
                  <RegisterPage
                    onSwitchToLogin={() => setAuthScreen('login')}
                    onBackToQr={
                      isDesktopBrowser()
                        ? () => {
                            setAuthScreen('login');
                            setDesktopStaffLogin(false);
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
