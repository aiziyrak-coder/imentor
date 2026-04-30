import React from 'react';
import { motion } from 'motion/react';
import {
  Brain,
  Microscope,
  ShieldCheck,
  Sparkles,
  Zap,
  Rocket,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';

type LandingAction = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

interface LandingShowcaseProps {
  role: 'admin' | 'hodim' | 'tarjimon';
  onNavigate: (viewId: string) => void;
}

const CORE_FEATURES: Array<{ title: string; text: string; icon: LucideIcon }> = [
  {
    title: 'AI Content Engine',
    text: "Syllabusdan mavzu ajratish, ma'ruza, taqdimot, case va testlarni bir oqimda yaratadi.",
    icon: Brain,
  },
  {
    title: 'Clinical Precision',
    text: 'Tibbiy terminologiya, diagnostik yondashuv va o‘qitish standartlariga mos kontent beradi.',
    icon: Microscope,
  },
  {
    title: 'Secure Workflow',
    text: 'Role-based kirish, ichki saqlash, qayta tahrirlash va boshqaruv paneli bilan himoyalangan jarayon.',
    icon: ShieldCheck,
  },
];

function actionsForRole(role: 'admin' | 'hodim' | 'tarjimon'): LandingAction[] {
  if (role === 'admin') {
    return [
      { id: 'admin-dashboard', label: 'Dashboard', description: 'Umumiy holat va monitoring', icon: Zap },
      { id: 'admin-staff', label: 'Hodimlar', description: 'Jamoani boshqarish', icon: Rocket },
      { id: 'admin-tests', label: 'Test bazasi', description: 'Nazorat materiallari', icon: Sparkles },
    ];
  }
  if (role === 'tarjimon') {
    return [
      { id: 'translator', label: 'Tarjima markazi', description: 'PDF va matn tarjimasi', icon: Sparkles },
      { id: 'profile', label: 'Profil', description: 'Shaxsiy sozlamalar', icon: ShieldCheck },
      { id: 'translator', label: 'Tez boshlash', description: 'Bir necha klikda ishga tushirish', icon: Zap },
    ];
  }
  return [
    { id: 'syllabus', label: 'Syllabus', description: 'Mavzularni ajratish', icon: Sparkles },
    { id: 'lectures', label: "Ma'ruza", description: 'Akademik matn tayyorlash', icon: Brain },
    { id: 'presentation', label: 'Taqdimot', description: 'Vizual slayd generator', icon: Rocket },
  ];
}

export default function LandingShowcase({ role, onNavigate }: LandingShowcaseProps) {
  const actions = actionsForRole(role);

  return (
    <div className="h-full overflow-y-auto scrollbar-hide p-4 md:p-6">
      <div className="relative rounded-[2rem] p-6 md:p-8 border border-white/70 bg-white/65 backdrop-blur-xl overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-100/40 via-white/20 to-emerald-100/40 pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-cyan-200/35 blur-3xl orb-float" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-emerald-200/35 blur-3xl orb-float" />

        <div className="relative z-10">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <p className="inline-flex items-center gap-2 text-[12px] font-semibold text-cyan-800 bg-cyan-100/70 border border-cyan-200 px-3 py-1 rounded-full">
              <Sparkles size={14} /> iMentor Future Hub
            </p>
            <h2 className="mt-4 text-3xl md:text-4xl font-black text-slate-900 leading-tight">
              AI + Tech + Meditsina
              <br />
              yagona o‘quv platformasi
            </h2>
            <p className="mt-4 max-w-3xl text-slate-700 text-[15px] leading-relaxed">
              iMentor dars tayyorlashdan tortib, klinik fikrlashni rivojlantirishgacha bo‘lgan barcha bosqichlarni
              avtomatlashtiradi. Platforma real pedagogik oqimni tezlashtiradi: tahlil, generatsiya, saqlash,
              nazorat va taqdimot.
            </p>
          </motion.div>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3">
            {CORE_FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.35 }}
                className="rounded-2xl border border-white/80 bg-white/70 px-4 py-4 shadow-sm"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 text-white flex items-center justify-center shadow">
                  <f.icon size={18} />
                </div>
                <h3 className="mt-3 text-[15px] font-bold text-slate-900">{f.title}</h3>
                <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">{f.text}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-6">
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">Tez boshlash</h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              {actions.map((a) => (
                <button
                  key={a.label + a.id}
                  onClick={() => onNavigate(a.id)}
                  className="group text-left rounded-2xl border border-white/80 bg-white/80 hover:bg-white px-4 py-4 transition shadow-sm hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                      <a.icon size={16} />
                    </div>
                    <ArrowRight size={16} className="text-slate-400 group-hover:text-cyan-600 transition-colors" />
                  </div>
                  <p className="mt-3 text-[14px] font-bold text-slate-900">{a.label}</p>
                  <p className="text-[12px] text-slate-600 mt-1">{a.description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
