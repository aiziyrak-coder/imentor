import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Beaker,
  Briefcase,
  FileDown,
  Loader2,
  Plus,
  Rocket,
  Save,
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
  updateStartupApplication,
  type StartupApplicationDto,
} from '../../utils/startupApplicationApi';
import StartupInnovationPackPanel from './StartupInnovationPackPanel';
import StartupCoachChat, { type CoachTurn } from './StartupCoachChat';

/** Qo‘shimcha maydonlar — AI va saqlash uchun */
export type WorkspaceFields = {
  research_question?: string;
  methodology_notes?: string;
  beneficiaries_or_segments?: string;
  monetization_or_sustainability?: string;
  key_resources_team?: string;
  partners_lab_equipment?: string;
};

const EMPTY_WORKSPACE: WorkspaceFields = {
  research_question: '',
  methodology_notes: '',
  beneficiaries_or_segments: '',
  monetization_or_sustainability: '',
  key_resources_team: '',
  partners_lab_equipment: '',
};

function normalizeDomain(d: string | undefined): 'startup' | 'research' {
  return d === 'research' ? 'research' : 'startup';
}

function parseWorkspaceProfile(raw: unknown): WorkspaceFields {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WORKSPACE };
  const o = raw as Record<string, unknown>;
  return {
    research_question: typeof o.research_question === 'string' ? o.research_question : '',
    methodology_notes: typeof o.methodology_notes === 'string' ? o.methodology_notes : '',
    beneficiaries_or_segments:
      typeof o.beneficiaries_or_segments === 'string' ? o.beneficiaries_or_segments : '',
    monetization_or_sustainability:
      typeof o.monetization_or_sustainability === 'string' ? o.monetization_or_sustainability : '',
    key_resources_team: typeof o.key_resources_team === 'string' ? o.key_resources_team : '',
    partners_lab_equipment: typeof o.partners_lab_equipment === 'string' ? o.partners_lab_equipment : '',
  };
}

function buildWorkspaceExtraNote(f: WorkspaceFields, domain: 'startup' | 'research'): string {
  if (domain === 'research') {
    return [
      f.research_question && `Tadqiqot savoli / gipoteza: ${f.research_question}`,
      f.methodology_notes && `Metod va dizayn: ${f.methodology_notes}`,
      f.partners_lab_equipment && `Laboratoriya / uskunalar / hamkorlar: ${f.partners_lab_equipment}`,
      f.key_resources_team && `Resurslar va jamoa: ${f.key_resources_team}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    f.beneficiaries_or_segments && `Maqsadli mijoz / beneficiarlar: ${f.beneficiaries_or_segments}`,
    f.monetization_or_sustainability && `Monetizatsiya / barqarorlik: ${f.monetization_or_sustainability}`,
    f.key_resources_team && `Jamoa va kalit resurslar: ${f.key_resources_team}`,
    f.partners_lab_equipment && `Hamkorlar, pilot maydon: ${f.partners_lab_equipment}`,
    f.research_question && `Qisman ilmiy savol (agar bor): ${f.research_question}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatProjectLabel(x: StartupApplicationDto): string {
  const dom = normalizeDomain(x.project_domain);
  const icon = dom === 'research' ? '🔬' : '🚀';
  const name = (x.title || 'Loyihasiz').trim() || 'Loyihasiz';
  const shortSum = (x.summary || '').trim().slice(0, 40);
  const sumPart = shortSum ? ` — ${shortSum}${(x.summary || '').length > 40 ? '…' : ''}` : '';
  return `${icon} ${name} · #${x.id}${sumPart}${x.status === 'submitted' ? ' ✓' : ''}`;
}

function mergePackKeepCoach(
  newPack: Record<string, unknown>,
  oldPack: Record<string, unknown> | undefined
): Record<string, unknown> {
  const thread = oldPack && Array.isArray((oldPack as { coach_thread?: unknown }).coach_thread)
    ? (oldPack as { coach_thread: CoachTurn[] }).coach_thread
    : undefined;
  if (thread && thread.length) {
    return { ...newPack, coach_thread: thread };
  }
  return { ...newPack };
}

function packForDisplay(pack: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!pack) return {};
  const { coach_thread: _c, ...rest } = pack;
  return rest;
}

function analysisExcerptForCoach(pack: Record<string, unknown> | undefined): string {
  const stripped = packForDisplay(pack);
  try {
    const s = JSON.stringify(stripped);
    return s.length > 14000 ? `${s.slice(0, 14000)}\n…[truncated]` : s;
  } catch {
    return '';
  }
}

function parseCoachThread(raw: unknown): CoachTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (!x || typeof x !== 'object') return null;
      const o = x as Record<string, unknown>;
      const role = o.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof o.content === 'string' ? o.content : '';
      if (!content) return null;
      const ts = typeof o.ts === 'number' ? o.ts : undefined;
      return { role, content, ts } as CoachTurn;
    })
    .filter(Boolean) as CoachTurn[];
}

export default function StartupWorkspace() {
  const printRef = useRef<HTMLDivElement | null>(null);

  const [items, setItems] = useState<StartupApplicationDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [coachSending, setCoachSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectDomain, setProjectDomain] = useState<'startup' | 'research'>('startup');
  const [ws, setWs] = useState<WorkspaceFields>({ ...EMPTY_WORKSPACE });

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [participantKind, setParticipantKind] = useState<'student' | 'employee'>('student');

  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) ?? null,
    [items, selectedId]
  );

  const coachTurns = useMemo(
    () => parseCoachThread(selected?.ai_pack?.coach_thread),
    [selected?.ai_pack]
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
    setProjectDomain(normalizeDomain(selected.project_domain));
    setWs(parseWorkspaceProfile(selected.workspace_profile));
  }, [selected?.id, selected?.updated_at]);

  const handleNew = async () => {
    setError(null);
    setSaving(true);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('not-auth');
      const pk = u.participantKind ?? 'student';
      const domain = projectDomain;
      const row = await createStartupApplication({
        title: domain === 'research' ? 'Yangi ilmiy loyiha' : 'Yangi startap loyiha',
        summary: '',
        description: '',
        participant_kind: pk,
        project_domain: domain,
        workspace_profile: {},
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => [row, ...prev]);
      setSelectedId(row.id);
      setWs({ ...EMPTY_WORKSPACE });
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
        project_domain: projectDomain,
        workspace_profile: { ...ws },
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
      const extra = buildWorkspaceExtraNote(ws, projectDomain);
      const rawPack = await aiService.generateStartupInnovationPack(
        title.trim() || 'Loyiha',
        summary,
        description,
        profileLine,
        getAppLanguage(),
        projectDomain,
        extra
      );
      const merged = mergePackKeepCoach(rawPack, selected.ai_pack);
      const row = await updateStartupApplication(selected.id, {
        ai_pack: merged,
        project_domain: projectDomain,
        workspace_profile: { ...ws },
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('AI tahlil ishlamadi (kalit yoki tarmoq). Qayta urinib ko‘ring.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleCoachSend = async (userText: string) => {
    if (!selected || selected.status === 'submitted') return;
    setCoachSending(true);
    setError(null);
    try {
      const u = getCurrentLocalUser();
      if (!u) throw new Error('not-auth');
      const prevThread = parseCoachThread(selected.ai_pack?.coach_thread);
      const nextUser: CoachTurn = { role: 'user', content: userText, ts: Date.now() };
      const messagesForModel = [...prevThread, nextUser];
      const replyText = await aiService.startupInnovationCoachReply(
        messagesForModel.map(({ role, content }) => ({ role, content })),
        {
          project_domain: projectDomain,
          title: title.trim() || 'Loyiha',
          summary,
          description,
          workspace_profile_json: JSON.stringify(ws),
          analysis_json_excerpt: analysisExcerptForCoach(selected.ai_pack),
        },
        getAppLanguage()
      );
      const assistantTurn: CoachTurn = {
        role: 'assistant',
        content: replyText,
        ts: Date.now(),
      };
      const newThread = [...prevThread, nextUser, assistantTurn].slice(-40);
      const mergedPack = {
        ...(selected.ai_pack || {}),
        coach_thread: newThread,
      };
      const row = await updateStartupApplication(selected.id, {
        ai_pack: mergedPack,
        profile_snapshot: buildStartupProfileSnapshot(u),
      });
      setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    } catch {
      setError('Suhbat javobi olinmadi. Qayta urinib ko‘ring.');
    } finally {
      setCoachSending(false);
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

  const displayPack = useMemo(() => packForDisplay(selected?.ai_pack), [selected?.ai_pack]);

  const updateWs = (patch: Partial<WorkspaceFields>) => setWs((prev) => ({ ...prev, ...patch }));

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
              Startap yoki ilmiy tadqiqot rejimi, kengaytirilgan profil va AI maslahatchi suhbati
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

      {/* Yangi loyiha turi (joriy tanlov — «Yangi loyiha» shu tipda yaratiladi) */}
      <div className="rounded-2xl border border-black/10 bg-white/70 p-3 sm:p-4 shadow-sm">
        <p className="text-[11px] font-semibold text-black/45 uppercase tracking-wide mb-2">
          Loyiha turi (yangi loyiha uchun)
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setProjectDomain('startup')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold border transition ${
              projectDomain === 'startup'
                ? 'bg-violet-600 text-white border-violet-600 shadow-md'
                : 'bg-white/80 text-black/70 border-black/10 hover:border-violet-300'
            }`}
          >
            <Briefcase size={16} />
            Startap / mahsulot
          </button>
          <button
            type="button"
            onClick={() => setProjectDomain('research')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold border transition ${
              projectDomain === 'research'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                : 'bg-white/80 text-black/70 border-black/10 hover:border-indigo-300'
            }`}
          >
            <Beaker size={16} />
            Ilmiy tadqiqot
          </button>
        </div>
        <p className="text-[11px] text-black/45 mt-2">
          Tanlangan tur «Yangi loyiha» tugmasida yaratiladi. Mavjud loyihada tur va maydonlarni o‘zgartirish uchun
          «Saqlash»ni bosing.
        </p>
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
        <div className="ios-glass rounded-2xl border border-white/60 p-8 text-center text-[14px] text-black/55 space-y-3">
          <p>Hozircha loyiha yo‘q.</p>
          <p className="text-[13px]">
            Yuqorida <strong>Startap</strong> yoki <strong>Ilmiy tadqiqot</strong>ni tanlang, keyin «Yangi loyiha»ni
            bosing.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-black/45 uppercase tracking-wide">Mening loyihalarim</span>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-[13px] font-medium min-w-[min(100%,420px)] max-w-full"
            >
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {formatProjectLabel(x)}
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
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-black/45">Joriy loyiha turi:</span>
              <span className="font-bold text-black/85">
                {projectDomain === 'research' ? '🔬 Ilmiy tadqiqot' : '🚀 Startap / innovatsiya'}
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Loyiha nomi</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isReadOnly}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] outline-none disabled:opacity-60"
                placeholder="Masalan: Telemedicine pilot yoki Biomarker tadqiqoti"
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

            {projectDomain === 'research' ? (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-indigo-200/60 bg-indigo-50/40 p-4">
                <p className="text-[12px] font-bold text-indigo-900">Ilmiy qatlam</p>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-black/50">Tadqiqot savoli / gipoteza</label>
                  <textarea
                    value={ws.research_question}
                    onChange={(e) => updateWs({ research_question: e.target.value })}
                    disabled={isReadOnly}
                    rows={2}
                    className="w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-[14px] disabled:opacity-60"
                    placeholder="Asosiy ilmiy savol yoki tekshiriladigan gipoteza"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-black/50">Metodologiya va dizayn</label>
                  <textarea
                    value={ws.methodology_notes}
                    onChange={(e) => updateWs({ methodology_notes: e.target.value })}
                    disabled={isReadOnly}
                    rows={3}
                    className="w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-[14px] disabled:opacity-60"
                    placeholder="Laboratoriya / klinik / statistik dizayn, namuna hajmi…"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-black/50">Laboratoriya / uskunalar / hamkorlar</label>
                  <textarea
                    value={ws.partners_lab_equipment}
                    onChange={(e) => updateWs({ partners_lab_equipment: e.target.value })}
                    disabled={isReadOnly}
                    rows={2}
                    className="w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-[14px] disabled:opacity-60"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-violet-200/60 bg-violet-50/40 p-4">
                <p className="text-[12px] font-bold text-violet-900">Startap qatlami</p>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-black/50">Maqsadli mijozlar / beneficiarlar</label>
                  <textarea
                    value={ws.beneficiaries_or_segments}
                    onChange={(e) => updateWs({ beneficiaries_or_segments: e.target.value })}
                    disabled={isReadOnly}
                    rows={2}
                    className="w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-[14px] disabled:opacity-60"
                    placeholder="Kim uchun, qaysi segment, muammo va to‘lovchi"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-black/50">Monetizatsiya / barqarorlik</label>
                  <textarea
                    value={ws.monetization_or_sustainability}
                    onChange={(e) => updateWs({ monetization_or_sustainability: e.target.value })}
                    disabled={isReadOnly}
                    rows={2}
                    className="w-full rounded-xl border border-black/10 bg-white/90 px-3 py-2 text-[14px] disabled:opacity-60"
                    placeholder="Grant, B2B, litsenziya, jamoat budjeti…"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Jamoa va kalit resurslar</label>
              <textarea
                value={ws.key_resources_team}
                onChange={(e) => updateWs({ key_resources_team: e.target.value })}
                disabled={isReadOnly}
                rows={2}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] outline-none resize-y disabled:opacity-60"
                placeholder="Kim bor, kimga kerak, qaysi ko‘nikmalar"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-black/50">Qisqa tavsif</label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={isReadOnly}
                rows={3}
                className="w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2.5 text-[14px] outline-none resize-y min-h-[80px] disabled:opacity-60"
                placeholder="Loyiha maqsadi, ijtimoiy yoki klinik ahamiyat (qisqa)"
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
                placeholder="Muammo, yechim, innovatsiya, reja, kutilayotgan natija, cheklovlar…"
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
                To‘liq AI tahlil
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

            <div className="rounded-xl border border-indigo-200/80 bg-indigo-50/60 px-3 py-2.5 text-[12px] text-indigo-950 leading-relaxed">
              <strong className="font-semibold">Administratorga yuborish:</strong> chap menyudan{' '}
              <span className="font-semibold">«Dossye va yuborish»</span> bo‘limiga o‘ting — jamoa, hujjatlar va yakuniy
              yuborish u yerda.
            </div>

            {selected && Object.keys(displayPack).length > 0 && (
              <div className="mt-2 space-y-3">
                <h3 className="text-[14px] font-bold text-black/90 tracking-tight">AI strategik tahlil</h3>
                <StartupInnovationPackPanel pack={displayPack} />
              </div>
            )}

            {selected && Object.keys(displayPack).length > 0 && (
              <StartupCoachChat
                turns={coachTurns}
                disabled={isReadOnly}
                sending={coachSending}
                onSend={handleCoachSend}
              />
            )}

            <p className="text-[11px] text-black/40 leading-relaxed">
              AI tavsiyalari maslahat xarakterida; rasmiy tasdiq emas. Suhbat tarixlari loyiha bilan saqlanadi.
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
              <p>
                <strong>Turi:</strong> {projectDomain === 'research' ? 'Ilmiy' : 'Startap'}
              </p>
              <h2>Qisqa tavsif</h2>
              <p>{summary}</p>
              <h2>Batafsil</h2>
              <p style={{ whiteSpace: 'pre-wrap' }}>{description}</p>
              {selected.ai_pack && Object.keys(packForDisplay(selected.ai_pack)).length > 0 && (
                <>
                  <h2>AI tahlil</h2>
                  <pre style={{ fontSize: 11 }}>{JSON.stringify(packForDisplay(selected.ai_pack), null, 2)}</pre>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
