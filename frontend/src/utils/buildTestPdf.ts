import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { MedicalReference, TestQuestion, TestSession } from '../services/aiService';
import { scoreToGrade } from './testGrading';

export interface TestSubmissionRow {
  firstName: string;
  lastName: string;
  answers: number[];
  submittedAt: number;
}

function slugifyTopic(topic: string): string {
  return topic.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'Test';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatReference(ref: MedicalReference): string {
  const parts = [ref.authors, ref.title, ref.year, ref.publisher].filter(Boolean);
  return parts.join(', ');
}

function referencesBlock(refs: MedicalReference[] | undefined, title: string): string {
  if (!refs?.length) return '';
  const items = refs
    .map((r) => `<li style="margin:4px 0;font-size:13px;color:#374151;">${escapeHtml(formatReference(r))}</li>`)
    .join('');
  return `
    <div style="margin:16px 0;padding:12px;background:#f9fafb;border-radius:8px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#4b5563;text-transform:uppercase;">${escapeHtml(title)}</p>
      <ul style="margin:0;padding-left:18px;">${items}</ul>
    </div>
  `;
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function buildQuestionsHtml(session: TestSession): string {
  const questionsHtml = session.questions
    .map((q, i) => {
      const options = q.options
        .map(
          (opt, optIdx) =>
            `<p style="margin:6px 0 6px 12px;font-size:14px;color:#1f2937;">${optionLetter(optIdx)}) ${escapeHtml(opt)}</p>`
        )
        .join('');
      return `
        <div style="margin-bottom:28px;page-break-inside:avoid;">
          <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111827;line-height:1.5;">
            ${i + 1}. ${escapeHtml(q.question)}
          </p>
          ${options}
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#4338ca;text-transform:uppercase;">Test savollari</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">${session.questions.length} ta savol · ${new Date().toLocaleString('uz-UZ')}</p>
      ${referencesBlock(session.references, 'Umumiy manbalar')}
      ${questionsHtml}
    </div>
  `;
}

function buildAnswerKeyHtml(session: TestSession): string {
  const questionsHtml = session.questions
    .map((q, i) => {
      const options = q.options
        .map((opt, optIdx) => {
          const isCorrect = optIdx === q.correctOptionIndex;
          const style = isCorrect
            ? 'margin:6px 0 6px 12px;padding:8px 10px;border-radius:8px;background:#ecfdf5;border:1px solid #34d399;font-size:14px;color:#065f46;font-weight:600;'
            : 'margin:6px 0 6px 12px;font-size:14px;color:#374151;';
          const marker = isCorrect ? ' ✓' : '';
          return `<p style="${style}">${optionLetter(optIdx)}) ${escapeHtml(opt)}${marker}</p>`;
        })
        .join('');
      const refs = referencesBlock(q.references, 'Savol manbalari');
      return `
        <div style="margin-bottom:32px;page-break-inside:avoid;">
          <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111827;line-height:1.5;">
            ${i + 1}. ${escapeHtml(q.question)}
          </p>
          ${options}
          <div style="margin-top:12px;padding:12px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">To'g'ri javob tahlili</p>
            <p style="margin:0;font-size:14px;color:#1e3a8a;line-height:1.6;white-space:pre-wrap;">${escapeHtml(q.explanation || '')}</p>
          </div>
          ${refs}
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#059669;text-transform:uppercase;">Test javob kaliti</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">${session.questions.length} ta savol · ${new Date().toLocaleString('uz-UZ')}</p>
      ${questionsHtml}
    </div>
  `;
}

function calculateScore(answers: number[], questions: TestQuestion[]): number {
  return answers.filter((a, i) => a === questions[i]?.correctOptionIndex).length;
}

function buildResultsHtml(session: TestSession, submissions: TestSubmissionRow[]): string {
  const total = session.questions.length;
  const sorted = [...submissions].sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
  const scores = sorted.map((s) => calculateScore(s.answers, session.questions));
  const grades = scores.map((score) => scoreToGrade(score, total));
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  const avgGrade = grades.length
    ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1)
    : '—';

  const rows = sorted
    .map((s, idx) => {
      const score = scores[idx];
      const grade = grades[idx];
      const pct = total > 0 ? Math.round((score / total) * 100) : 0;
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;font-size:13px;color:#6b7280;">${idx + 1}</td>
          <td style="padding:10px 8px;font-size:14px;font-weight:600;color:#111827;">${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</td>
          <td style="padding:10px 8px;font-size:14px;color:#111827;">${score} / ${total} (${pct}%)</td>
          <td style="padding:10px 8px;font-size:14px;font-weight:700;color:#111827;text-align:center;">${grade}</td>
          <td style="padding:10px 8px;font-size:13px;color:#6b7280;">${new Date(s.submittedAt).toLocaleString('uz-UZ')}</td>
        </tr>
      `;
    })
    .join('');

  const detailBlocks = sorted
    .map((s, idx) => {
      const score = scores[idx];
      const grade = grades[idx];
      const answerCells = session.questions
        .map((q, qi) => {
          const picked = s.answers[qi];
          const correct = q.correctOptionIndex;
          const ok = picked === correct;
          const pickedLabel = picked >= 0 && picked < q.options.length ? optionLetter(picked) : '—';
          const correctLabel = optionLetter(correct);
          const color = ok ? '#059669' : '#dc2626';
          return `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:6px;background:${ok ? '#ecfdf5' : '#fef2f2'};color:${color};font-size:12px;font-weight:600;">${qi + 1}: ${pickedLabel}${ok ? '' : ` (to'g'ri: ${correctLabel})`}</span>`;
        })
        .join('');
      return `
        <div style="margin-bottom:20px;padding:14px;border:1px solid #e5e7eb;border-radius:10px;page-break-inside:avoid;">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#111827;">
            ${idx + 1}. ${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)} — ${score}/${total} · Baho: ${grade}
          </p>
          <div>${answerCells}</div>
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#b45309;text-transform:uppercase;">Test natijalari</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">
        Topshirganlar: ${sorted.length} · O'rtacha ball: ${avg} / ${total} · O'rtacha baho: ${avgGrade} · ${new Date().toLocaleString('uz-UZ')}
      </p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0 32px;">
        <thead>
          <tr style="border-bottom:2px solid #d1d5db;text-align:left;">
            <th style="padding:10px 8px;font-size:12px;color:#6b7280;">#</th>
            <th style="padding:10px 8px;font-size:12px;color:#6b7280;">Talaba</th>
            <th style="padding:10px 8px;font-size:12px;color:#6b7280;">Ball</th>
            <th style="padding:10px 8px;font-size:12px;color:#6b7280;">Baho</th>
            <th style="padding:10px 8px;font-size:12px;color:#6b7280;">Vaqt</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="5" style="padding:24px;text-align:center;color:#9ca3af;">Natija yo'q</td></tr>`}</tbody>
      </table>
      ${sorted.length > 0 ? `<p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;">Batafsil javoblar</p>${detailBlocks}` : ''}
    </div>
  `;
}

async function renderHtmlToPdf(html: string, filename: string): Promise<void> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '760px';
  container.style.background = '#ffffff';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    const pageHeight = pdf.internal.pageSize.getHeight();
    let position = 0;
    let heightLeft = pdfHeight;

    pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = position - pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}

export async function downloadTestQuestionsPdf(session: TestSession): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildQuestionsHtml(session), `Test_${slug}.pdf`);
}

export async function downloadTestAnswerKeyPdf(session: TestSession): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildAnswerKeyHtml(session), `Test_Kalit_${slug}.pdf`);
}

export async function downloadTestResultsPdf(
  session: TestSession,
  submissions: TestSubmissionRow[]
): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildResultsHtml(session, submissions), `Test_Natijalar_${slug}.pdf`);
}
