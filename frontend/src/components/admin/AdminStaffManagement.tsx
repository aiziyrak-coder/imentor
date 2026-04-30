import React, { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Pencil, Trash2, Loader2, AlertCircle, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  listAllStaffUsers,
  adminCreateStaffUser,
  adminUpdateStaffUser,
  adminDeleteStaffUser,
  normalizeUserRole,
  subscribeLocalAuth,
  type LocalStaffUser,
  type UserRole,
} from '../../utils/localStaffAuth';

function formatLastActive(ts: number | undefined): string {
  if (ts == null || Number.isNaN(ts)) return '—';
  try {
    return new Date(ts).toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

const emptyForm = {
  phoneDisplay: '+998',
  password: '',
  firstName: '',
  lastName: '',
  faculty: '',
  department: '',
  direction: '',
  role: 'hodim' as UserRole,
};

export default function AdminStaffManagement() {
  const [rows, setRows] = useState<LocalStaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<LocalStaffUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      setRows(listAllStaffUsers());
    } catch {
      setError('Ma’lumotlarni olishda xato (admin huquqi kerak).');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = subscribeLocalAuth(() => {
      try {
        setRows(listAllStaffUsers());
      } catch {
        /* admin emas — ro‘yxatni yangilash shart emas */
      }
    });
    return () => unsub();
  }, []);

  const startEdit = (u: LocalStaffUser) => {
    setEditing(u);
    setForm({
      phoneDisplay: u.phoneDisplay,
      password: '',
      firstName: u.firstName,
      lastName: u.lastName,
      faculty: u.faculty,
      department: u.department,
      direction: u.direction,
      role: normalizeUserRole(u),
    });
    setShowAdd(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (form.password.length < 6) {
        setError('Parol kamida 6 belgi.');
        return;
      }
      adminCreateStaffUser({
        phoneDisplay: form.phoneDisplay.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        faculty: form.faculty.trim(),
        department: form.department.trim(),
        direction: form.direction.trim(),
        role: form.role,
      });
      setForm(emptyForm);
      setShowAdd(false);
      load();
    } catch (err: unknown) {
      const c = err instanceof Error ? err.message : '';
      if (c === 'already-exists') setError('Bu telefon allaqachon band.');
      else if (c === 'forbidden') setError('Ruxsat yo‘q.');
      else setError('Yaratishda xato.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const patch: Parameters<typeof adminUpdateStaffUser>[1] = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        displayName: `${form.firstName} ${form.lastName}`.trim(),
        phoneDisplay: form.phoneDisplay.trim(),
        faculty: form.faculty.trim(),
        department: form.department.trim(),
        direction: form.direction.trim(),
        role: form.role,
      };
      if (form.password.trim().length >= 6) {
        patch.password = form.password;
      }
      adminUpdateStaffUser(editing.uid, patch);
      setEditing(null);
      setForm(emptyForm);
      load();
    } catch (err: unknown) {
      const c = err instanceof Error ? err.message : '';
      if (c === 'last-admin') setError('Yagona admin rolini olib bo‘lmaydi.');
      else if (c === 'phone-exists') setError('Bu telefon band.');
      else setError('Yangilashda xato.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (u: LocalStaffUser) => {
    if (!window.confirm(`${u.displayName} o‘chirilsinmi?`)) return;
    setError(null);
    try {
      adminDeleteStaffUser(u.uid);
      load();
    } catch (err: unknown) {
      const c = err instanceof Error ? err.message : '';
      if (c === 'cannot-delete-self') setError('O‘zingizni o‘chira olmaysiz.');
      else if (c === 'last-admin') setError('Yagona administratorni o‘chirib bo‘lmaydi.');
      else setError('O‘chirishda xato.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16 px-2 sm:px-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Hodimlar boshqaruvi</h1>
            <p className="text-[12px] text-black/50">Qo‘shish, tahrirlash, o‘chirish</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowAdd(true);
            setEditing(null);
            setForm({ ...emptyForm, password: 'Temp1234' });
            setError(null);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold shadow-md"
        >
          <Plus size={18} /> Hodim qo‘shish
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="ios-glass rounded-2xl border border-white/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-black/[0.04] text-black/55 font-semibold">
              <tr>
                <th className="px-4 py-3">FIO</th>
                <th className="px-4 py-3">Telefon</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Fakultet</th>
                <th className="px-4 py-3 whitespace-nowrap min-w-[140px]">Oxirgi faollik</th>
                <th className="px-4 py-3 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-black/45">
                    <Loader2 className="animate-spin inline mr-2" size={18} />
                    Yuklanmoqda...
                  </td>
                </tr>
              ) : (
                rows.map((u) => (
                  <tr key={u.uid} className="hover:bg-black/[0.02]">
                    <td className="px-4 py-2.5 font-medium text-black/90">{u.displayName}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px]">{u.phoneDisplay}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/5 text-[11px] font-semibold">
                        {normalizeUserRole(u) === 'admin' && <Shield size={12} />}
                        {normalizeUserRole(u)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-black/65 max-w-[180px] truncate">{u.faculty}</td>
                    <td className="px-4 py-2.5 text-black/55 tabular-nums text-[12px] whitespace-nowrap">
                      {formatLastActive(u.lastActiveAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(u)}
                          className="p-2 rounded-lg hover:bg-black/5 text-indigo-600"
                          title="Tahrirlash"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          className="p-2 rounded-lg hover:bg-rose-500/10 text-rose-600"
                          title="O‘chirish"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {(showAdd || editing) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="ios-glass rounded-2xl border border-white/60 p-6 space-y-4"
          >
            <h2 className="text-lg font-bold text-black/90">{editing ? 'Hodimni tahrirlash' : 'Yangi hodim'}</h2>
            <form onSubmit={editing ? handleUpdate : handleCreate} className="grid sm:grid-cols-2 gap-3">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">Telefon</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.phoneDisplay}
                  onChange={(e) => setForm((f) => ({ ...f, phoneDisplay: e.target.value }))}
                  required
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">
                  Parol {editing && '(bo‘sh qoldiring — o‘zgarmaydi)'}
                </span>
                <input
                  type="password"
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required={!editing}
                  placeholder={editing ? '••••••' : ''}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-black/50">Ism</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-black/50">Familiya</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">Fakultet</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.faculty}
                  onChange={(e) => setForm((f) => ({ ...f, faculty: e.target.value }))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-black/50">Kafedra</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-black/50">Yo‘nalish</span>
                <input
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.direction}
                  onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-semibold text-black/50">Rol</span>
                <select
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-[14px]"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                >
                  <option value="hodim">Hodim</option>
                  <option value="admin">Administrator</option>
                  <option value="tarjimon">Tarjimon</option>
                </select>
              </label>
              <div className="sm:col-span-2 flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin inline" /> : editing ? 'Saqlash' : 'Yaratish'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setShowAdd(false);
                    setForm(emptyForm);
                  }}
                  className="px-6 py-3 rounded-xl border border-black/10 font-semibold"
                >
                  Bekor
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
