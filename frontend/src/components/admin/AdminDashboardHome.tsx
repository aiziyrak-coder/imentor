import React, { useMemo, useState } from 'react';
import { LayoutDashboard, Users, BriefcaseMedical, ClipboardList, RefreshCw, LogIn, Activity } from 'lucide-react';
import { motion } from 'motion/react';
import { getActivitySummary } from '../../utils/staffActivityLog';
import { getContentLibraryCounts } from '../../utils/staffContentLibrary';
import { listAllStaffUsers } from '../../utils/localStaffAuth';

/**
 * Administrator bosh sahifasi: nazorat ko‘rsatkichlari (dars o‘tkazilmaydi).
 */
export default function AdminDashboardHome() {
  const [tick, setTick] = useState(0);

  const summary = useMemo(() => {
    try {
      return getActivitySummary();
    } catch {
      return null;
    }
  }, [tick]);

  const lib = useMemo(() => {
    try {
      return getContentLibraryCounts();
    } catch {
      return { cases: 0, tests: 0 };
    }
  }, [tick]);

  const staffCount = useMemo(() => {
    try {
      return listAllStaffUsers().length;
    } catch {
      return 0;
    }
  }, [tick]);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16 px-2 sm:px-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-800 text-white flex items-center justify-center shadow-lg">
            <LayoutDashboard size={30} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black/90 tracking-tight">Dashboard</h1>
            <p className="text-[13px] text-black/50 font-medium">
              Tizim nazorati: hodimlar, kontent bazasi, faollik
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-black/10 bg-white/90 text-[13px] font-semibold text-black/70 shadow-sm"
        >
          <RefreshCw size={16} /> Yangilash
        </button>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Ro‘yxatdan foydalanuvchilar', value: staffCount, icon: Users, c: 'bg-slate-100 border-slate-200 text-slate-800' },
          { label: 'Keys yozuvlari (bazada)', value: lib.cases, icon: BriefcaseMedical, c: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
          { label: 'Test yozuvlari (bazada)', value: lib.tests, icon: ClipboardList, c: 'bg-blue-50 border-blue-200 text-blue-900' },
          { label: 'Bugungi kirishlar', value: summary?.loginsToday ?? 0, icon: LogIn, c: 'bg-amber-50 border-amber-200 text-amber-900' },
        ].map((card) => (
          <div key={card.label} className={`rounded-2xl border p-4 ${card.c}`}>
            <div className="flex items-center gap-2 mb-1 opacity-80">
              <card.icon size={16} />
              <span className="text-[10px] font-bold uppercase tracking-wide leading-tight">{card.label}</span>
            </div>
            <p className="text-2xl font-bold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {summary && (
        <div className="ios-glass rounded-2xl border border-white/60 p-5 text-[13px] text-black/70">
          <div className="flex items-center gap-2 font-semibold text-black/85 mb-2">
            <Activity size={18} /> Faollik (jurnal)
          </div>
          <p>
            Jami: kirish {summary.totalLogins}, chiqish {summary.totalLogouts}, ro‘yxatdan o‘tish{' '}
            {summary.totalRegisters}. Oxirgi 7 kunda kirishlar: {summary.lastSevenDaysLogins}.
          </p>
        </div>
      )}

      <p className="text-[12px] text-black/45 text-center max-w-lg mx-auto">
        Dars va kontent yaratish faqat <span className="font-semibold text-black/60">hodim</span> hisobida. Administrator
        bu yerda nazorat va bazalarni boshqaradi.
      </p>
    </div>
  );
}
