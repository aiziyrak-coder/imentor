import React, { useMemo, useState } from 'react';
import { LayoutDashboard, Users, BriefcaseMedical, ClipboardList, RefreshCw, LogIn, Activity } from 'lucide-react';
import { motion } from 'motion/react';
import { getActivitySummary } from '../../utils/staffActivityLog';
import { getContentLibraryCounts } from '../../utils/staffContentLibrary';
import { listAllStaffUsers } from '../../utils/localStaffAuth';
import { useUiText } from '../../i18n/useUiText';

/**
 * Administrator bosh sahifasi: nazorat ko‘rsatkichlari (dars o‘tkazilmaydi).
 */
export default function AdminDashboardHome() {
  const { t } = useUiText();
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

  const cards = useMemo(
    () => [
      { key: 'registered', label: t('admin.registeredUsers'), value: staffCount, icon: Users, c: 'bg-slate-100 border-slate-200 text-slate-800' },
      { key: 'cases', label: t('admin.caseRecords'), value: lib.cases, icon: BriefcaseMedical, c: 'bg-emerald-50 border-emerald-200 text-emerald-900' },
      { key: 'tests', label: t('admin.testRecords'), value: lib.tests, icon: ClipboardList, c: 'bg-blue-50 border-blue-200 text-blue-900' },
      { key: 'logins', label: t('admin.todayLogins'), value: summary?.loginsToday ?? 0, icon: LogIn, c: 'bg-amber-50 border-amber-200 text-amber-900' },
    ],
    [t, staffCount, lib.cases, lib.tests, summary?.loginsToday],
  );

  return (
    <div className="w-full space-y-8 pb-16 px-3 sm:px-5 lg:px-6 py-4">
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
            <h1 className="text-2xl font-bold text-black/90 tracking-tight">{t('admin.dashboardTitle')}</h1>
            <p className="text-[13px] text-black/50 font-medium">{t('admin.dashboardSubtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-black/10 bg-white/90 text-[13px] font-semibold text-black/70 shadow-sm"
        >
          <RefreshCw size={16} /> {t('admin.refresh')}
        </button>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div key={card.key} className={`rounded-2xl border p-4 ${card.c}`}>
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
            <Activity size={18} /> {t('admin.activityLog')}
          </div>
          <p>
            {t('admin.activitySummary', {
              totalLogins: summary.totalLogins,
              totalLogouts: summary.totalLogouts,
              totalRegisters: summary.totalRegisters,
              lastSevenDaysLogins: summary.lastSevenDaysLogins,
            })}
          </p>
        </div>
      )}

      <p className="text-[12px] text-black/45 text-center max-w-lg mx-auto">
        {t('admin.dashboardNote', { hodim: t('admin.hodimRole') })}
      </p>
    </div>
  );
}
