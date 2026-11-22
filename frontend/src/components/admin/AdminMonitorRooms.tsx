import { useState } from 'react';
import { Monitor, Stethoscope } from 'lucide-react';
import AdminRoomsCatalog from './AdminRoomsCatalog';
import AdminScopeSubjects from './AdminScopeSubjects';

/**
 * «Monitorli xonalar» (2026-11-16).
 *
 * * «Xonalar» — HEMIS'dagi HAMMA faol xonalar (barcha binolar); monitor bor-yo'qligi qo'lda belgilanadi
 *   (`AdminRoomsCatalog`). Ilgari bu yerda Google jadvaldan olingan kafedra × monitorli xona jadvali
 *   turardi — foydalanuvchi uni rad etdi: "hamma xonalar bo'lsin, monitorni o'zimiz belgilaymiz".
 * * «Nazoratdagi fanlar» — qaysi fan klinik (rektor hisoboti faqat klinik fanlarning amaliy
 *   mashg'ulotlarini monitorli xonada nazorat qiladi).
 */
export default function AdminMonitorRooms() {
  const [tab, setTab] = useState<'rooms' | 'subjects'>('rooms');
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-[22px] font-bold text-slate-900"><Monitor size={22} className="text-sky-600" /> Monitorli xonalar</h1>
        <p className="mt-1 max-w-3xl text-[14px] text-slate-600">
          Rektor hisobotida nazorat qilinadigan dars: <b>klinik fan</b> + <b>amaliy mashg‘ulot</b> + <b>monitor bor xona</b>.
          Pastda HEMIS’dagi barcha faol xonalar — monitor qo‘yilgan xonani «Monitor bor» qilib belgilang.
        </p>
        <span className="mt-3 inline-flex rounded-xl bg-slate-100 p-0.5">
          {([['rooms', 'Xonalar', Monitor], ['subjects', 'Nazoratdagi fanlar', Stethoscope]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[14px] font-semibold ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </span>
      </div>
      {tab === 'rooms' ? <AdminRoomsCatalog /> : <AdminScopeSubjects />}
    </div>
  );
}
