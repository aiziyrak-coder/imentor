import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  FileDown,
  Loader2,
  Plus,
  Rocket,
  Save,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { getAppLanguage } from '../../i18n/language';
import { aiService } from '../../services/aiService';
import { buildStartupProfileSnapshot, getCurrentLocalUser } from '../../utils/localStaffAuth';
import {
  createStartupApplication,
  deleteStartupApplication,
  listMyStartupApplications,
  submitStartupApplication,
  updateStartupApplication,
  type StartupApplicationDto,
} from '../../utils/startupApplicationApi';

function fmtPackKey(key: string): string {
  return key.replace(/_/g, ' ');
}

export default function StartupWorkspace() {
  const printRef = useRef<HTMLDivElement | null>(null);

  const [items, setItems] = useState<StartupApplicationDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [participantKind, setParticipantKind] = useState<'student' | 'employee'>('student');

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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (msg === 'no-backend-token' || msg.includes('HTTP 401')) {
        setError('Serverga kirish muddati tugagan. Chiqing va qayta kiring.');
      } else {
        setError("Ma'lumotlarni yuklashda xato. Internet yoki serverni tekshiring.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    setTitle(selected.title);
    setSummary(selected.summary);
    setDescription(selected.description);
    const pk = selected.participant_kind === 'employee' ? 'employee' : 'student';
    setParticipantKind(pk);
  }, [selected?.id, selected?.updated_at]);

  const handleNew = async () => {
    setError(null);
    setSaving(true);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('not-auth');
      const pk = u.participantKind ?? 'student';
      const row = await createStartupApplication({
        title: 'Yangi loyiha',
        summary: '',
        description: '',
        participant_kind: pk,
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => [row, ...prev]);
      setSelectedId(row.id);
    } catch {
      setError('Yangi loyiha yaratishda xato.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!selected || selected.status === 'submitted') return;
    setError(null);
    setSaving(true);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('not-auth');
      const row = await updateStartupApplication(selected.id, {
        title: title.trim() || 'Loyihasiz',
        summary,
        description,
        participant_kind: participantKind,
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('Saqlashda xato yoki tizimdan kirish muddati tugagan.');
    } finally {
      setSaving(false);
    }
  };

  const handleAi = async () => {
    if (!selected || selected.status === 'submitted') return;
    setError(null);
    setAiLoading(true);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('not-auth');
      const profileLine = [
        `Fakultet: ${u.faculty}; Kafedra: ${u.department}; Yo‘nalish: ${u.direction}`,
        u.participantKind === 'employee'
          ? `Lavozim: ${u.jobTitle ?? '—'}`
          : `Guruh: ${u.studyGroup ?? '—'}`,
      ].join('. ');
      const pack = await aiService.generateStartupInnovationPack(
        title.trim() || 'Loyiha',
        summary,
        description,
        profileLine,
        getAppLanguage()
      );
      const row = await updateStartupApplication(selected.id, {
        ai_pack: pack,
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('AI tahlil ishlamadi (kalit yoki tarmoq). Qayta urinib ko‘ring.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selected || selected.status === 'submitted') return;
    setError(null);
    setSaving(true);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('not-auth');
      await updateStartupApplication(selected.id, {
        title: title.trim() || 'Loyiha',
        summary,
        description,
        participant_kind: participantKind,
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      const row = await submitStartupApplication(selected.id);
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('Yuborishda xato. Avval saqlab, qayta urinib ko‘ring.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || selected.status === 'submitted') return;
    if (!window.confirm('Loyiha o‘chirilsinmi?')) return;
    setError(null);
    setSaving(true);
    try {
      await deleteStartupApplication(selected.id);
      setItems((prev) => {
        const next = prev.filter((x) => x.id !== selected.id);
        setSelectedId(next[0]?.id ?? null);
        return next;
      });
    } catch {
      setError('O‘chirishda xato.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>Loyiha — chop etish</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111;line-height:1.45;max-width:800px;margin:0 auto}
        h1{font-size:20px} h2{font-size:15px;margin-top:1.2em} pre{white-space:pre-wrap;font-size:12px}
        @media print{body{padding:0}}
      </style></head><body>${printRef.current.innerHTML}</body></html>`
    );
    w.document.close();
    w.focus();
    w.print();
    w.close();
  };

  const isReadOnly = selected?.status === 'submitted';

  return (
    <div className="max-w-4xl mx-auto space-y-6 px-2 sm:px-4 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-md">
            <Rocket size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-black/90">Startap va innovatsiya</h1>
            <p className="text-[12px] text-black/50">
              FJSTI standartlariga yaqinlashtirish, AI tahlil va administratorga ariza
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleNew()}
          disabled={saving || loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-md disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          Yangi loyiha
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-black/50 gap-2 text-[14px]">
          <Loader2 className="animate-spin" size={20} />
          Yuklanmoqda…
        </div>
      ) : items.length === 0 ? (
        <div className="ios-glass rounded-2xl border border-white/60 p-8 text-center text-black/55 text-[14px]">
          Hozircha loyiha yo‘q. «Yangi loyiha»ni bosing.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-black/45 uppercase tracking-wide">Mening loyihalarim</span>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-[13px] font-medium min-w-[200px]"
            >
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title.slice(0, 48)}
                  {x.status === 'submitted' ? ' ✓' : ''}
                </option>
              ))}
            </select>
            {selected?.status === 'submitted' && (
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                Administratorga yuborilgan
              </span>
            )}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="ios-glass rounded-2xl border border-white/60 p-5 sm:p-6 space-y-4"
          >
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Loyiha nomi</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isReadOnly}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] outline-none disabled:opacity-60"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-black/50">Ishtirokchi turi</label>
                <select
                  value={participantKind}
                  onChange={(e) => setParticipantKind(e.target.value as 'student' | 'employee')}
                  disabled={isReadOnly}
                  className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] disabled:opacity-60"
                >
                  <option value="student">Talaba</option>
                  <option value="employee">Xodim</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Qisqa tavsif</label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={isReadOnly}
                rows={3}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] outline-none resize-y min-h-[80px] disabled:opacity-60"
                placeholder="Loyiha maqsadi, ijtimoiy ahamiyati (qisqa)"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Batafsil tavsif</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isReadOnly}
                rows={8}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] outline-none resize-y min-h-[180px] disabled:opacity-60"
                placeholder="Muammo, yechim, innovatsiya, reja, kutilayotgan natija…"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || isReadOnly}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Saqlash
              </button>
              <button
                type="button"
                onClick={() => void handleAi()}
                disabled={aiLoading || isReadOnly}
                className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {aiLoading ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                AI tahlil va hujjat reja
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || isReadOnly}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                Administratorga yuborish
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-2 rounded-xl border border-black/15 bg-white/90 px-4 py-2.5 text-[13px] font-semibold text-black/80"
              >
                <FileDown size={16} />
                PDF / chop etish
              </button>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 text-rose-700 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  O‘chirish
                </button>
              )}
            </div>

            {selected && Object.keys(selected.ai_pack || {}).length > 0 && (
              <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
                <h3 className="text-[13px] font-bold text-violet-900">AI natijasi</h3>
                <div className="space-y-3 text-[13px] text-black/80">
                  {Object.entries(selected.ai_pack).map(([k, v]) => (
                    <div key={k} className="border-b border-black/5 pb-2 last:border-0">
                      <p className="text-[11px] font-semibold text-black/45 uppercase tracking-wide mb-1">
                        {fmtPackKey(k)}
                      </p>
                      {Array.isArray(v) ? (
                        <ul className="list-disc pl-5 space-y-1">
                          {(v as unknown[]).map((item, i) => (
                            <li key={i} className="break-words">
                              {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                            </li>
                          ))}
                        </ul>
                      ) : typeof v === 'object' && v !== null ? (
                        <pre className="text-[12px] whitespace-pre-wrap break-words bg-white/60 rounded-lg p-2">
                          {JSON.stringify(v, null, 2)}
                        </pre>
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{String(v)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-black/40 leading-relaxed">
              AI tavsiyalari tibbiy yoki rasmiy hujjat emas; yakuniy matnni institut qoidalari bo‘yicha tekshiring.
            </p>
          </motion.div>
        </div>
      )}

      <div className="sr-only" aria-hidden>
        <div ref={printRef}>
          {selected && (
            <div>
              <h1>{title || 'Loyiha'}</h1>
              <p>
                <strong>Holat:</strong> {selected.status === 'submitted' ? 'Yuborilgan' : 'Qoralama'}
              </p>
              <h2>Qisqa tavsif</h2>
              <p>{summary}</p>
              <h2>Batafsil</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{description}</p>
              {selected.ai_pack && Object.keys(selected.ai_pack).length > 0 && (
                <>
                  <h2>AI tahlil (qisqacha)</h2>
                  <pre style={{ fontSize: 12 }}>{JSON.stringify(selected.ai_pack, null, 2)}</pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
