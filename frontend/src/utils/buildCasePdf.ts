import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { CaseStudySession, MedicalReference } from '../services/aiService';
import { caseFocusLabel } from './caseFocusLabels';

function slugifyTopic(topic: string): string {
  return topic.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 60) || 'Keys';
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

function keywordsBlock(keywords: string[] | undefined): string {
  if (!keywords?.length) return '';
  return `
    <p style="margin:0 0 24px;font-size:13px;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:10px 12px;border-radius:8px;">
      <strong>Kalit so'zlar:</strong> ${escapeHtml(keywords.join(', '))}
    </p>
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

function buildScenariosHtml(session: CaseStudySession): string {
  const items = session.questions
    .map(
      (q, i) => `
        <div style="margin-bottom:28px;page-break-inside:avoid;">
          ${q.focus ? `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#047857;text-transform:uppercase;">${escapeHtml(caseFocusLabel(q.focus))}</p>` : ''}
          <p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#111827;line-height:1.6;white-space:pre-wrap;">
            ${i + 1}. ${escapeHtml(q.scenario || '')}
          </p>
        </div>
      `
    )
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#059669;text-transform:uppercase;">Klinik keys savollar</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">${session.questions.length} ta keys · ${new Date().toLocaleString('uz-UZ')}</p>
      ${keywordsBlock(session.keywords)}
      ${referencesBlock(session.references, 'Umumiy manbalar')}
      ${items}
    </div>
  `;
}

function buildAnswerKeyHtml(session: CaseStudySession): string {
  const items = session.questions
    .map((q, i) => {
      const refs = referencesBlock(q.references, 'Keys manbalari');
      return `
        <div style="margin-bottom:32px;page-break-inside:avoid;">
          ${q.focus ? `<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">${escapeHtml(caseFocusLabel(q.focus))}</p>` : ''}
          <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#374151;line-height:1.5;white-space:pre-wrap;">
            ${i + 1}. ${escapeHtml((q.scenario || '').slice(0, 180))}${(q.scenario || '').length > 180 ? '…' : ''}
          </p>
          <div style="margin-top:12px;padding:12px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;">Keys javobi</p>
            <p style="margin:0;font-size:14px;color:#1e3a8a;line-height:1.6;white-space:pre-wrap;">${escapeHtml(q.answer || '')}</p>
          </div>
          ${refs}
        </div>
      `;
    })
    .join('');

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;background:#fff;color:#111827;max-width:760px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#2563eb;text-transform:uppercase;">Keys javob kaliti</p>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;line-height:1.3;">${escapeHtml(session.topic)}</h1>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">${session.questions.length} ta keys · ${new Date().toLocaleString('uz-UZ')}</p>
      ${keywordsBlock(session.keywords)}
      ${items}
    </div>
  `;
}

export async function downloadCaseScenariosPdf(session: CaseStudySession): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildScenariosHtml(session), `Keys_Savollar_${slug}.pdf`);
}

export async function downloadCaseAnswerKeyPdf(session: CaseStudySession): Promise<void> {
  const slug = slugifyTopic(session.topic);
  await renderHtmlToPdf(buildAnswerKeyHtml(session), `Keys_Kalit_${slug}.pdf`);
}
