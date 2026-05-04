import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Building2, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import {
  createAdminCampusBuilding,
  deleteAdminCampusBuilding,
  listAdminCampusBuildings,
  patchAdminCampusBuilding,
  type CampusBuildingDto,
} from '../../utils/staffLocationApi';

const emptyForm = {
  name: '',
  short_code: '',
  latitude: '41.311151',
  longitude: '69.279737',
  radius_m: 1000,
  sort_order: 0,
  notes: '',
};

export default function AdminCampusBuildingsPage() {
  const [rows, setRows] = useState<CampusBuildingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<typeof emptyForm & { is_active: boolean }>({ ...emptyForm, is_active: true });

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setRows(await listAdminCampusBuildings());
    } catch {
      setError('Binolarni olishda xato (admin JWT).');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (r: CampusBuildingDto) => {
    setEditingId(r.id);
    setEditForm({
      name: r.name,
      short_code: r.short_code,
      latitude: String(r.latitude),
      longitude: String(r.longitude),
      radius_m: r.radius_m,
      sort_order: r.sort_order,
      notes: r.notes,
      is_active: r.is_active,
    });
  };

  const saveEdit = async () => {
    if (editingId == null) return;
    const lat = Number(editForm.latitude);
    const lng = Number(editForm.longitude);
    if (!editForm.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Nom va koordinatalar to'g'ri to'ldirilsin.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchAdminCampusBuilding(editingId, {
        name: editForm.name.trim(),
        short_code: editForm.short_code.trim(),
        latitude: lat,
        longitude: lng,
        radius_m: editForm.radius_m,
        sort_order: editForm.sort_order,
        notes: editForm.notes.trim(),
        is_active: editForm.is_active,
      });
      setEditingId(null);
      await load();
    } catch {
      setError('Saqlashda xato.');
    } finally {
      setSaving(false);
    }
  };

  const addNew = async () => {
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("Yangi bino: nom va koordinata majburiy.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createAdminCampusBuilding({
        name: form.name.trim(),
        short_code: form.short_code.trim(),
        latitude: lat,
        longitude: lng,
        radius_m: form.radius_m,
        sort_order: form.sort_order,
        notes: form.notes.trim(),
        is_active: true,
      });
      setForm(emptyForm);
      await load();
    } catch {
      setError("Qo'shishda xato.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Bino o‘chirilsinmi? (jadvalda ishlatilayotgan bo‘lsa, xato beradi)')) return;
    setError(null);
    try {
      await deleteAdminCampusBuilding(id);
      if (editingId === id) setEditingId(null);
      await load();
    } catch {
      setError("O'chirishda xato yoki jadvalda ishlatilmoqda.");
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-2 sm:px-4 pb-24">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-slate-700 text-white flex items-center justify-center">
          <Building2 size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-black/90">Kampus binolari</h1>
          <p className="text-[12px] text-black/50">Oldindan kiritiladi; jadvalda shu ro‘yxatdan tanlanadi (GPS bino bo‘yicha)</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-black/50 gap-2">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : (
        <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-black/[0.04] text-black/55">
              <tr>
                <th className="px-3 py-2">Tartib</th>
                <th className="px-3 py-2">Bino</th>
                <th className="px-3 py-2">Kod</th>
                <th className="px-3 py-2">lat / lng</th>
                <th className="px-3 py-2">R (m)</th>
                <th className="px-3 py-2">Holat</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-black/5 align-top">
                  {editingId === r.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-16 rounded border border-black/10 px-1 py-1"
                          value={editForm.sort_order}
                          onChange={(e) => setEditForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full min-w-[140px] rounded border border-black/10 px-2 py-1"
                          value={editForm.name}
                          onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-20 rounded border border-black/10 px-1 py-1"
                          value={editForm.short_code}
                          onChange={(e) => setEditForm((f) => ({ ...f, short_code: e.target.value }))}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] space-y-1">
                        <input
                          className="w-full rounded border border-black/10 px-1 py-0.5"
                          value={editForm.latitude}
                          onChange={(e) => setEditForm((f) => ({ ...f, latitude: e.target.value }))}
                        />
                        <input
                          className="w-full rounded border border-black/10 px-1 py-0.5"
                          value={editForm.longitude}
                          onChange={(e) => setEditForm((f) => ({ ...f, longitude: e.target.value }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-20 rounded border border-black/10 px-1 py-1"
                          value={editForm.radius_m}
                          onChange={(e) => setEditForm((f) => ({ ...f, radius_m: Number(e.target.value) || 1000 }))}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex items-center gap-1 text-[12px]">
                          <input
                            type="checkbox"
                            checked={editForm.is_active}
                            onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                          />
                          Faol
                        </label>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 text-white px-2 py-1 text-[12px] font-semibold"
                        >
                          <Save size={14} />
                          Saqlash
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="text-[12px] text-black/60 ml-1">
                          Bekor
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2">{r.sort_order}</td>
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2 text-black/60">{r.short_code || '—'}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">
                        {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                      </td>
                      <td className="px-3 py-2">{r.radius_m}</td>
                      <td className="px-3 py-2">{r.is_active ? 'Faol' : 'O‘chirilgan'}</td>
                      <td className="px-3 py-2 text-right space-x-1">
                        <button
                          type="button"
                          onClick={() => startEdit(r)}
                          className="inline-flex p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                          aria-label="Tahrirlash"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(r.id)}
                          className="inline-flex p-1.5 rounded-lg text-rose-600 hover:bg-rose-50"
                          aria-label="O‘chirish"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-black/45 text-[13px]">Hozircha bino yo‘q.</div>
          )}
        </div>
      )}

      <div className="ios-glass rounded-2xl border border-white/60 p-4 space-y-3">
        <h2 className="text-[14px] font-bold text-black/85 flex items-center gap-2">
          <Plus size={18} />
          Yangi bino
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
            Nomi
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
              placeholder="Masalan: Anatomiya korpusi"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
            Qisqa kod (ixtiyoriy)
            <input
              value={form.short_code}
              onChange={(e) => setForm((f) => ({ ...f, short_code: e.target.value }))}
              className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
              placeholder="K1"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
            Lat
            <input
              value={form.latitude}
              onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
              className="rounded-xl border border-black/10 px-3 py-2 font-mono text-[14px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
            Lng
            <input
              value={form.longitude}
              onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
              className="rounded-xl border border-black/10 px-3 py-2 font-mono text-[14px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
            Radius (m)
            <input
              type="number"
              value={form.radius_m}
              onChange={(e) => setForm((f) => ({ ...f, radius_m: Number(e.target.value) || 1000 }))}
              className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60">
            Tartib
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
              className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-black/60 sm:col-span-2">
            Izoh
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="rounded-xl border border-black/10 px-3 py-2 text-[14px]"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void addNew()}
          disabled={saving}
          className="rounded-xl bg-slate-800 text-white px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50"
        >
          Bino qo‘shish
        </button>
      </div>
    </div>
  );
}
