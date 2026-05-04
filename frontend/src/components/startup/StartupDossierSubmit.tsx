import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  FileUp,
  Loader2,
  Plus,
  Send,
  Trash2,
  Users,
  FolderOpen,
  Save,
} from 'lucide-react';
import { motion } from 'motion/react';
import { buildStartupProfileSnapshot, getCurrentLocalUser } from '../../utils/localStaffAuth';
import {
  listMyStartupApplications,
  submitStartupApplication,
  updateStartupApplication,
  type StartupApplicationDto,
} from '../../utils/startupApplicationApi';

const MAX_FILE_BYTES = 380_000;
const MAX_FILES = 8;

export type DossierTeamMember = {
  id: string;
  full_name: string;
  role: string;
  organization: string;
  contact: string;
};

export type DossierAttachment = {
  id: string;
  file_name: string;
  mime_type: string;
  label: string;
  size_bytes: number;
  base64: string;
};

export type SubmissionDossierShape = {
  project_kind?: 'startup' | 'research' | 'hybrid';
  team_members?: DossierTeamMember[];
  applicant_notes?: string;
  vc_one_liner?: string;
  attachments?: DossierAttachment[];
};

function newId(): string {
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = r.result;
      if (typeof res !== 'string') {
        reject(new Error('read-fail'));
        return;
      }
      const idx = res.indexOf(',');
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    r.onerror = () => reject(r.error ?? new Error('read-fail'));
    r.readAsDataURL(file);
  });
}

export default function StartupDossierSubmit() {
  const [items, setItems] = useState<StartupApplicationDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectKind, setProjectKind] = useState<'startup' | 'research' | 'hybrid'>('hybrid');
  const [vcOneLiner, setVcOneLiner] = useState('');
  const [notes, setNotes] = useState('');
  const [team, setTeam] = useState<DossierTeamMember[]>([]);
  const [attachments, setAttachments] = useState<DossierAttachment[]>([]);

  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) ?? null,
    [items, selectedId]
  );

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await listMyStartupApplications();
      setItems(list);
      setSelectedId((prev) => {
        if (list.length === 0) return null;
        if (prev != null && list.some((x) => x.id === prev)) return prev;
        return list[0].id;
      });
    } catch {
      setError('Ro‘yxatni yuklashda xato.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const d = (selected.submission_dossier || {}) as SubmissionDossierShape;
    setProjectKind(d.project_kind ?? 'hybrid');
    setVcOneLiner(typeof d.vc_one_liner === 'string' ? d.vc_one_liner : '');
    setNotes(typeof d.applicant_notes === 'string' ? d.applicant_notes : '');
    if (Array.isArray(d.team_members) && d.team_members.length > 0) {
      setTeam(
        d.team_members.map((m) => ({
          id: m.id || newId(),
          full_name: m.full_name ?? '',
          role: m.role ?? '',
          organization: m.organization ?? '',
          contact: m.contact ?? '',
        }))
      );
    } else {
      setTeam([]);
    }
    if (Array.isArray(d.attachments)) {
      setAttachments(
        d.attachments.map((a) => ({
          id: a.id || newId(),
          file_name: a.file_name,
          mime_type: a.mime_type,
          label: a.label ?? '',
          size_bytes: a.size_bytes,
          base64: a.base64,
        }))
      );
    } else {
      setAttachments([]);
    }
  }, [selected?.id, selected?.updated_at]);

  const buildDossierPayload = (): Record<string, unknown> => ({
    project_kind: projectKind,
    vc_one_liner: vcOneLiner.trim(),
    applicant_notes: notes.trim(),
    team_members: team.map(({ id, full_name, role, organization, contact }) => ({
      id,
      full_name: full_name.trim(),
      role: role.trim(),
      organization: organization.trim(),
      contact: contact.trim(),
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      file_name: a.file_name,
      mime_type: a.mime_type,
      label: a.label,
      size_bytes: a.size_bytes,
      base64: a.base64,
    })),
    dossier_version: 1,
    updated_at_iso: new Date().toISOString(),
  });

  const handleSaveDossier = async () => {
    if (!selected || selected.status === 'submitted') return;
    setSaving(true);
    setError(null);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('auth');
      const row = await updateStartupApplication(selected.id, {
        submission_dossier: buildDossierPayload(),
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('Dossyeni saqlashda xato.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitAdmin = async () => {
    if (!selected || selected.status === 'submitted') return;
    setSubmitting(true);
    setError(null);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('auth');
      await updateStartupApplication(selected.id, {
        submission_dossier: buildDossierPayload(),
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      const row = await submitStartupApplication(selected.id);
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('Yuborishda xato. Internet yoki huquqni tekshiring.');
    } finally {
      setSubmitting(false);
    }
  };

  const addTeamRow = () => {
    setTeam((t) => [...t, { id: newId(), full_name: '', role: '', organization: '', contact: '' }]);
  };

  const updateTeam = (id: string, patch: Partial<DossierTeamMember>) => {
    setTeam((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeTeam = (id: string) => setTeam((rows) => rows.filter((r) => r.id !== id));

  const onPickFiles: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    setError(null);
    const next = [...attachments];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (next.length >= MAX_FILES) {
        setError(`Eng ko‘pi bilan ${MAX_FILES} ta fayl.`);
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(`"${file.name}" juda katta (>${Math.round(MAX_FILE_BYTES / 1024)} KB). PDF/rasmni siqing.`);
        continue;
      }
      try {
        const b64 = await readFileAsBase64(file);
        next.push({
          id: newId(),
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          label: '',
          size_bytes: file.size,
          base64: b64,
        });
      } catch {
        setError(`"${file.name}" o‘qilmadi.`);
      }
    }
    setAttachments(next);
    e.target.value = '';
  };

  const removeAttachment = (id: string) => setAttachments((a) => a.filter((x) => x.id !== id));

  const dossierBytes = useMemo(() => {
    try {
      return new Blob([JSON.stringify(buildDossierPayload())]).size;
    } catch {
      return 0;
    }
  }, [projectKind, vcOneLiner, notes, team, attachments]);

  const dossierTooLarge = dossierBytes > 4_500_000;

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-2 sm:px-4 pb-24">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
          <FolderOpen size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-black/90">Dossye va administratorga yuborish</h1>
          <p className="text-[12px] text-black/50">
            Jamoa, qisqa pitch, ilmiy/startap hujjatlari — keyin rasmiy yuborish
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-black/50">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : items.length === 0 ? (
        <div className="ios-glass rounded-2xl border border-white/60 p-8 text-center text-[14px] text-black/55">
          Avval «Innovatsiya loyihasi» bo‘limida yangi loyiha yarating.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold text-black/45 uppercase">Loyiha</label>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-[13px] font-medium min-w-[220px]"
            >
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title.slice(0, 56)}
                  {x.status === 'submitted' ? ' ✓' : ''}
                </option>
              ))}
            </select>
            {selected?.status === 'submitted' && (
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                Yuborilgan
              </span>
            )}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="ios-glass rounded-2xl border border-white/60 p-5 sm:p-6 space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-black/50">Loyiha turi</label>
                <select
                  value={projectKind}
                  onChange={(e) => setProjectKind(e.target.value as 'startup' | 'research' | 'hybrid')}
                  disabled={selected?.status === 'submitted'}
                  className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] disabled:opacity-60"
                >
                  <option value="startup">Startap / mahsulot</option>
                  <option value="research">Ilmiy tadqiqot / ishlanma</option>
                  <option value="hybrid">Aralash</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-black/50">Elevator / bir qatorlik pitch</label>
                <input
                  value={vcOneLiner}
                  onChange={(e) => setVcOneLiner(e.target.value)}
                  disabled={selected?.status === 'submitted'}
                  placeholder="Masalan: sun’iy intellekt bilan ... aniqlaymiz"
                  className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] disabled:opacity-60"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-black/80">
                  <Users size={16} className="text-indigo-600" />
                  <span className="text-[13px] font-bold">Jamoa a’zolari</span>
                </div>
                {selected?.status !== 'submitted' && (
                  <button
                    type="button"
                    onClick={addTeamRow}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold px-2.5 py-1.5"
                  >
                    <Plus size={14} /> Qator
                  </button>
                )}
              </div>
              {team.length === 0 && (
                <p className="text-[12px] text-black/45">Hali kiritilmagan — «Qator» bilan qo‘shing.</p>
              )}
              <div className="space-y-2">
                {team.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 rounded-xl border border-black/8 bg-white/70 p-3"
                  >
                    <input
                      className="sm:col-span-3 rounded-lg border border-black/10 px-2 py-2 text-[13px]"
                      placeholder="F.I.Sh."
                      value={row.full_name}
                      onChange={(e) => updateTeam(row.id, { full_name: e.target.value })}
                      disabled={selected?.status === 'submitted'}
                    />
                    <input
                      className="sm:col-span-3 rounded-lg border border-black/10 px-2 py-2 text-[13px]"
                      placeholder="Rol (masalan: RA)"
                      value={row.role}
                      onChange={(e) => updateTeam(row.id, { role: e.target.value })}
                      disabled={selected?.status === 'submitted'}
                    />
                    <input
                      className="sm:col-span-3 rounded-lg border border-black/10 px-2 py-2 text-[13px]"
                      placeholder="Tashkilot / kafedra"
                      value={row.organization}
                      onChange={(e) => updateTeam(row.id, { organization: e.target.value })}
                      disabled={selected?.status === 'submitted'}
                    />
                    <div className="sm:col-span-3 flex gap-1">
                      <input
                        className="flex-1 rounded-lg border border-black/10 px-2 py-2 text-[13px]"
                        placeholder="Aloqa (email / tel.)"
                        value={row.contact}
                        onChange={(e) => updateTeam(row.id, { contact: e.target.value })}
                        disabled={selected?.status === 'submitted'}
                      />
                      {selected?.status !== 'submitted' && (
                        <button
                          type="button"
                          onClick={() => removeTeam(row.id)}
                          className="p-2 rounded-lg border border-rose-200 text-rose-600 bg-rose-50"
                          aria-label="O‘chirish"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-black/50 flex items-center gap-2">
                <FileUp size={14} /> Hujjatlar (PDF, rasmlar — har biri ~{Math.round(MAX_FILE_BYTES / 1024)} KB gacha)
              </label>
              {selected?.status !== 'submitted' && (
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                  onChange={onPickFiles}
                  className="block w-full text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-white file:font-semibold"
                />
              )}
              {attachments.length === 0 ? (
                <p className="text-[12px] text-black/45">Ixtiyoriy: grant ariza, metodika, rasmiylashtirish.</p>
              ) : (
                <ul className="space-y-2">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-[13px]"
                    >
                      <span className="font-medium text-black/85 truncate max-w-[200px]">{a.file_name}</span>
                      <span className="text-[11px] text-black/45">
                        {(a.size_bytes / 1024).toFixed(1)} KB
                      </span>
                      <input
                        className="flex-1 min-w-[120px] rounded-lg border border-black/10 px-2 py-1 text-[12px]"
                        placeholder="Izoh (masalan: Grant loyiha)"
                        value={a.label}
                        onChange={(e) =>
                          setAttachments((prev) =>
                            prev.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x))
                          )
                        }
                        disabled={selected?.status === 'submitted'}
                      />
                      {selected?.status !== 'submitted' && (
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.id)}
                          className="text-rose-600 text-[12px] font-semibold"
                        >
                          O‘chirish
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Qo‘shimcha izoh (admin uchun)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={selected?.status === 'submitted'}
                rows={4}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] resize-y disabled:opacity-60"
                placeholder="Masalan: laboratoriya sinovi muddati, hamkor tashkilot…"
              />
            </div>

            {dossierTooLarge && (
              <p className="text-[12px] text-rose-700 font-semibold">
                Dossye juda katta (~{(dossierBytes / 1e6).toFixed(1)} MB). Ba’zi fayllarni olib tashlang yoki siqing.
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={saving || selected?.status === 'submitted' || dossierTooLarge}
                onClick={() => void handleSaveDossier()}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Dossyeni saqlash
              </button>
              <button
                type="button"
                disabled={submitting || selected?.status === 'submitted' || dossierTooLarge}
                onClick={() => void handleSubmitAdmin()}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {submitting ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                Administratorga yuborish
              </button>
            </div>

            <p className="text-[11px] text-black/40 leading-relaxed">
              «Yuborish»dan oldin «Loyiha va AI» bo‘limida matn va AI tahlilni saqlagan bo‘lishingiz ma’qul.
              Fayllar bazaga JSON ichida saqlanadi — juda katta hajmlardan qoching.
            </p>
          </motion.div>
        </div>
      )}
    </div>
  );
}
