import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowRight,
  BookOpen,
  BriefcaseMedical,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Globe,
  GraduationCap,
  Languages,
  LogIn,
  MapPin,
  Presentation,
  Rocket,
  Shield,
  Sparkles,
  Users,
  X,
  Zap,
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

function t(lang: AppLanguage, key: Parameters<typeof translate>[1]) {
  return translate(lang, key);
}

export default function PublicLandingPage({
  language,
  setLanguage,
  isMobileDevice,
  desktopStaffLogin,
  setDesktopStaffLogin,
}: Props) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [catalogExpanded, setCatalogExpanded] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const openAuth = useCallback((screen: AuthScreen = 'login') => {
    setAuthScreen(screen);
    setAuthOpen(true);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsLibrary = params.get('library') === '1' || window.location.hash === '#public-catalog';
    if (wantsLibrary) {
      setCatalogExpanded(true);
      setTimeout(() => scrollTo('public-catalog'), 300);
    }
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const features = [
    { icon: FileText, titleKey: 'publicLanding.featureLecture' as const, descKey: 'publicLanding.featureLectureDesc' as const, color: 'from-sky-500 to-blue-600' },
    { icon: BriefcaseMedical, titleKey: 'publicLanding.featureCases' as const, descKey: 'publicLanding.featureCasesDesc' as const, color: 'from-emerald-500 to-teal-600' },
    { icon: ClipboardList, titleKey: 'publicLanding.featureTests' as const, descKey: 'publicLanding.featureTestsDesc' as const, color: 'from-violet-500 to-indigo-600' },
    { icon: Presentation, titleKey: 'publicLanding.featurePresentation' as const, descKey: 'publicLanding.featurePresentationDesc' as const, color: 'from-amber-500 to-orange-600' },
    { icon: Languages, titleKey: 'publicLanding.featureTranslation' as const, descKey: 'publicLanding.featureTranslationDesc' as const, color: 'from-cyan-500 to-teal-600' },
    { icon: Rocket, titleKey: 'publicLanding.featureStartup' as const, descKey: 'publicLanding.featureStartupDesc' as const, color: 'from-rose-500 to-pink-600' },
  ];

  const steps = [
    { num: '01', titleKey: 'publicLanding.step1Title' as const, descKey: 'publicLanding.step1Desc' as const },
    { num: '02', titleKey: 'publicLanding.step2Title' as const, descKey: 'publicLanding.step2Desc' as const },
    { num: '03', titleKey: 'publicLanding.step3Title' as const, descKey: 'publicLanding.step3Desc' as const },
  ];

  const roles = [
    { icon: Shield, titleKey: 'publicLanding.roleAdmin' as const, descKey: 'publicLanding.roleAdminDesc' as const },
    { icon: GraduationCap, titleKey: 'publicLanding.roleHodim' as const, descKey: 'publicLanding.roleHodimDesc' as const },
    { icon: Languages, titleKey: 'publicLanding.roleTranslator' as const, descKey: 'publicLanding.roleTranslatorDesc' as const },
    { icon: Rocket, titleKey: 'publicLanding.roleStartuper' as const, descKey: 'publicLanding.roleStartuperDesc' as const },
  ];

  const stats = [
    { value: '8+', labelKey: 'publicLanding.statModules' as const },
    { value: '3', labelKey: 'publicLanding.statLanguages' as const },
    { value: 'AI', labelKey: 'publicLanding.statAi' as const },
    { value: 'FJSTI', labelKey: 'publicLanding.statInstitute' as const },
  ];

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-[#fafbfc] text-[#0a1628]">
      {/* ── Header ── */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'border-b border-black/[0.06] bg-white/80 backdrop-blur-xl shadow-sm'
            : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5 min-w-0">
            <img src="/imentor-logo.png" alt="iMentor" className="h-9 w-9 rounded-xl object-cover border border-white/80 shadow-md shrink-0" />
            <span className={`font-bold text-[17px] tracking-tight ${scrolled ? 'text-[#0a1628]' : 'text-white'}`}>iMentor</span>
          </button>

          <nav className={`hidden md:flex items-center gap-6 text-[13px] font-medium ${scrolled ? 'text-[#0a1628]/70' : 'text-white/75'}`}>
            <button type="button" onClick={() => scrollTo('features')} className="hover:text-emerald-400 transition-colors">
              {t(language, 'publicLanding.navFeatures')}
            </button>
            <button type="button" onClick={() => scrollTo('how-it-works')} className="hover:text-emerald-400 transition-colors">
              {t(language, 'publicLanding.navHowItWorks')}
            </button>
            <button type="button" onClick={() => scrollTo('public-catalog')} className="hover:text-emerald-400 transition-colors">
              {t(language, 'publicLanding.navCatalog')}
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as AppLanguage)}
              className={`h-9 rounded-lg border px-2 text-[11px] font-semibold ${
                scrolled ? 'border-black/10 bg-white text-[#0a1628]' : 'border-white/20 bg-white/10 text-white backdrop-blur'
              }`}
              aria-label={t(language, 'shell.languageAria')}
            >
              <option value="uz">{languageLabel('uz')}</option>
              <option value="ru">{languageLabel('ru')}</option>
              <option value="en">{languageLabel('en')}</option>
            </select>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className={`hidden sm:inline-flex h-9 items-center px-3 text-[13px] font-semibold transition-colors ${
                scrolled ? 'text-[#0a1628]/70 hover:text-[#0a1628]' : 'text-white/80 hover:text-white'
              }`}
            >
              {t(language, 'publicLanding.login')}
            </button>
            <button
              type="button"
              onClick={() => openAuth('login')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-400 transition-colors"
            >
              {t(language, 'publicLanding.getStarted')} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-[#0a1628] text-white">
        <div className="landing-grid-bg absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="landing-glow absolute -top-32 left-[10%] h-[500px] w-[500px] rounded-full bg-emerald-500/20 blur-[120px] orb-float" />
          <div className="landing-glow absolute top-[30%] -right-32 h-[600px] w-[600px] rounded-full bg-cyan-500/15 blur-[140px] orb-float" style={{ animationDelay: '2s' }} />
          <div className="landing-glow absolute -bottom-20 left-[40%] h-[400px] w-[400px] rounded-full bg-indigo-500/15 blur-[100px] orb-float" style={{ animationDelay: '4s' }} />
        </div>

        <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 pt-28 pb-20 lg:pt-36 lg:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="space-y-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300">
                <Sparkles size={13} /> {t(language, 'publicLanding.badge')}
              </div>

              <h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.5rem] font-black leading-[1.08] tracking-tight">
                {t(language, 'publicLanding.heroTitle')}
                <br />
                <span className="landing-gradient-text">{t(language, 'publicLanding.heroTitleAccent')}</span>
              </h1>

              <p className="text-[16px] sm:text-[18px] leading-relaxed text-white/65 max-w-xl">
                {t(language, 'publicLanding.heroSubtitle')}
              </p>

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => openAuth('login')}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-[14px] font-bold text-[#0a1628] shadow-xl hover:bg-white/90 transition-colors"
                >
                  {t(language, 'publicLanding.getStarted')} <ArrowRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => scrollTo('public-catalog')}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 backdrop-blur px-6 py-3.5 text-[14px] font-semibold text-white/90 hover:bg-white/10 transition-colors"
                >
                  <BookOpen size={16} /> {t(language, 'publicLanding.openCatalog')}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 max-w-lg">
                {stats.map((s) => (
                  <div key={s.labelKey} className="text-center sm:text-left">
                    <p className="text-2xl font-black text-white">{s.value}</p>
                    <p className="text-[11px] text-white/50 font-medium mt-0.5">{t(language, s.labelKey)}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Product preview card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="relative hidden lg:block"
            >
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-1 shadow-2xl shadow-black/40">
                <div className="rounded-xl bg-[#111827] overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                    <div className="flex gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                    </div>
                    <span className="text-[11px] text-white/40 font-mono ml-2">imentor.uz</span>
                  </div>
                  <div className="p-5 space-y-3">
                    {[
                      { icon: BookOpen, label: translate(language, 'welcome.featureSyllabus'), color: 'text-sky-400 bg-sky-500/10' },
                      { icon: FileText, label: translate(language, 'publicLanding.featureLecture'), color: 'text-emerald-400 bg-emerald-500/10' },
                      { icon: BriefcaseMedical, label: translate(language, 'publicLanding.featureCases'), color: 'text-teal-400 bg-teal-500/10' },
                      { icon: ClipboardList, label: translate(language, 'publicLanding.featureTests'), color: 'text-violet-400 bg-violet-500/10' },
                      { icon: Presentation, label: translate(language, 'welcome.featurePresentation'), color: 'text-amber-400 bg-amber-500/10' },
                    ].map((item, i) => (
                      <motion.div
                        key={item.label}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4 + i * 0.08 }}
                        className="flex items-center gap-3 rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3"
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.color}`}>
                          <item.icon size={16} />
                        </div>
                        <span className="text-[13px] text-white/80 font-medium">{item.label}</span>
                        <Zap size={12} className="ml-auto text-emerald-400/60" />
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-4 -right-4 rounded-xl border border-emerald-400/30 bg-emerald-500/20 backdrop-blur px-4 py-2.5 text-[12px] font-bold text-emerald-200 shadow-lg">
                <Sparkles size={12} className="inline mr-1.5" /> DeepSeek AI
              </div>
            </motion.div>
          </div>
        </div>

        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-[#fafbfc] to-transparent" />
      </section>

      {/* ── Trusted by ── */}
      <section className="relative z-10 -mt-6 mx-auto max-w-6xl px-4 sm:px-6">
        <div className="rounded-2xl border border-black/[0.06] bg-white px-6 py-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[13px] text-black/45 font-medium">{t(language, 'publicLanding.trustedBy')}</p>
          <div className="flex items-center gap-4">
            <img src="/imentor-logo.png" alt="" className="h-8 w-8 rounded-lg opacity-80" />
            <div>
              <p className="text-[14px] font-bold text-[#0a1628]">FJSTI</p>
              <p className="text-[11px] text-black/45">{t(language, 'publicLanding.brandSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-black/40">
            <Globe size={14} />
            <span>O&apos;zbek · Русский · English</span>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 py-20 lg:py-28">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#0a1628]">
            {t(language, 'publicLanding.featuresTitle')}
          </h2>
          <p className="text-[16px] text-black/50 mt-4 leading-relaxed">
            {t(language, 'publicLanding.featuresSubtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <motion.div
              key={f.titleKey}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ delay: i * 0.06 }}
              className="group rounded-2xl border border-black/[0.06] bg-white p-6 shadow-sm hover:shadow-lg hover:border-black/10 transition-all duration-300"
            >
              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${f.color} text-white flex items-center justify-center shadow-md mb-4 group-hover:scale-105 transition-transform`}>
                <f.icon size={20} />
              </div>
              <h3 className="text-[16px] font-bold text-[#0a1628] mb-2">{t(language, f.titleKey)}</h3>
              <p className="text-[14px] text-black/50 leading-relaxed">{t(language, f.descKey)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="bg-[#0a1628] text-white py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{t(language, 'publicLanding.howTitle')}</h2>
            <p className="text-[16px] text-white/50 mt-4">{t(language, 'publicLanding.howSubtitle')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative"
              >
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[calc(100%+0.5rem)] w-[calc(100%-1rem)] h-px bg-gradient-to-r from-emerald-500/40 to-transparent" />
                )}
                <div className="text-[48px] font-black text-emerald-500/20 leading-none mb-3">{step.num}</div>
                <h3 className="text-[18px] font-bold mb-2">{t(language, step.titleKey)}</h3>
                <p className="text-[14px] text-white/55 leading-relaxed">{t(language, step.descKey)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Roles ── */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-20 lg:py-28">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#0a1628]">
            {t(language, 'publicLanding.rolesTitle')}
          </h2>
          <p className="text-[16px] text-black/50 mt-4">{t(language, 'publicLanding.rolesSubtitle')}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {roles.map((role, i) => (
            <motion.div
              key={role.titleKey}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07 }}
              className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 rounded-xl bg-[#0a1628]/5 flex items-center justify-center mb-3">
                <role.icon size={18} className="text-[#0a1628]/70" />
              </div>
              <h3 className="text-[15px] font-bold text-[#0a1628] mb-1.5">{t(language, role.titleKey)}</h3>
              <p className="text-[13px] text-black/50 leading-relaxed">{t(language, role.descKey)}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-emerald-200/60 bg-gradient-to-r from-emerald-50 to-teal-50 p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <MapPin size={20} className="text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-emerald-900">{t(language, 'publicLanding.gpsTitle')}</p>
            <p className="text-[13px] text-emerald-800/70 mt-0.5">{t(language, 'publicLanding.gpsDesc')}</p>
          </div>
          <button
            type="button"
            onClick={() => openAuth('login')}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-emerald-500 transition-colors"
          >
            <Users size={14} /> {t(language, 'publicLanding.login')}
          </button>
        </div>
      </section>

      {/* ── Compact open catalog ── */}
      <section id="public-catalog-section" className="mx-auto max-w-6xl px-4 sm:px-6 pb-8">
        <div className="rounded-2xl border border-black/[0.06] bg-white shadow-sm overflow-hidden">
          <div className="px-5 sm:px-7 pt-6 pb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-black/[0.04]">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600 mb-2">
                <BookOpen size={12} /> {t(language, 'publicLanding.featureNoLogin')}
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-[#0a1628] tracking-tight">
                {t(language, 'publicLanding.catalogSectionTitle')}
              </h2>
              <p className="text-[14px] text-black/50 mt-1 max-w-xl">{t(language, 'publicLanding.catalogSectionSubtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCatalogExpanded((v) => !v);
                if (!catalogExpanded) {
                  setTimeout(() => scrollTo('public-catalog'), 100);
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-[#fafbfc] px-4 py-2.5 text-[13px] font-semibold text-[#0a1628] hover:bg-black/[0.03] transition-colors shrink-0"
            >
              {catalogExpanded ? (
                <>
                  <ChevronUp size={16} /> {t(language, 'publicLanding.collapseCatalog')}
                </>
              ) : (
                <>
                  <ChevronDown size={16} /> {t(language, 'publicLanding.expandCatalog')}
                </>
              )}
            </button>
          </div>

          <div className="px-5 sm:px-7 py-5">
            <PublicContentCatalog
              language={language}
              embedded
              compact={!catalogExpanded}
              expanded={catalogExpanded}
              onExpandChange={setCatalogExpanded}
              previewLimit={6}
            />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 lg:py-20">
        <div className="relative overflow-hidden rounded-3xl bg-[#0a1628] px-8 py-14 sm:px-14 sm:py-16 text-center text-white">
          <div className="landing-glow absolute -top-20 left-1/2 -translate-x-1/2 h-[300px] w-[500px] rounded-full bg-emerald-500/20 blur-[100px]" />
          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{t(language, 'publicLanding.ctaTitle')}</h2>
            <p className="text-[16px] text-white/60 leading-relaxed">{t(language, 'publicLanding.ctaSubtitle')}</p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => openAuth('login')}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-7 py-3.5 text-[15px] font-bold text-white shadow-lg shadow-emerald-500/30 hover:bg-emerald-400 transition-colors"
              >
                {t(language, 'publicLanding.getStarted')} <ArrowRight size={16} />
              </button>
              <button
                type="button"
                onClick={() => openAuth('register')}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-7 py-3.5 text-[15px] font-semibold text-white/90 hover:bg-white/10 transition-colors"
              >
                {t(language, 'publicLanding.staffAccess')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-black/[0.06] bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/imentor-logo.png" alt="iMentor" className="h-10 w-10 rounded-xl object-cover border border-black/5" />
              <div>
                <p className="font-bold text-[#0a1628]">iMentor</p>
                <p className="text-[12px] text-black/45">{t(language, 'welcome.footerInstitute')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-black/45">
              <span>{t(language, 'footer.copyright')}</span>
              <a href="https://fjsti.uz" target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                {t(language, 'footer.developer')}
              </a>
              <a href="https://fjsti.uz" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-600 hover:underline">
                {t(language, 'footer.supporter')}
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* ── Auth modal ── */}
      <AnimatePresence>
        {authOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-[#0a1628]/50 backdrop-blur-sm p-0 sm:p-4"
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              className="w-full sm:max-w-[560px] max-h-[92dvh] overflow-y-auto rounded-t-[2rem] sm:rounded-[2rem] bg-white shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/95 backdrop-blur px-5 py-4">
                <p className="font-bold text-[#0a1628]">{t(language, 'publicLanding.authPanelTitle')}</p>
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
                  <DesktopHodimQrLogin onOtherRoles={() => setDesktopStaffLogin(true)} />
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
