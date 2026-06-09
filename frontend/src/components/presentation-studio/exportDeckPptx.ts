import type { Slide } from '../../services/presentationTypes';

function parseStatValue(v: string): number {
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function exportDeckToPptx(topic: string, slides: Slide[]): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  pres.title = topic || 'Taqdimot';
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'iMentor — FJSTI';

  const dark = '0F172A';
  const primary = '0EA5E9';
  const white = 'FFFFFF';
  const text = '1E293B';

  pres.defineSlideMaster({
    title: 'TITLE',
    background: { color: dark },
    objects: [
      { rect: { x: 8, y: -1, w: 4, h: 4, fill: { color: primary, transparency: 40 } } },
    ],
  });

  pres.defineSlideMaster({
    title: 'CONTENT',
    background: { color: white },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.65, fill: { color: dark } } },
      { rect: { x: 0, y: 0.65, w: '100%', h: 0.03, fill: { color: primary } } },
    ],
    slideNumber: { x: '92%', y: '94%', fontSize: 9, color: '94A3B8' },
  });

  slides.forEach((slide, index) => {
    const isTitle = slide.layout === 'title' || index === 0;
    if (isTitle) {
      const s = pres.addSlide({ masterName: 'TITLE' });
      s.addText(slide.title || topic, {
        x: 0.7,
        y: 1.8,
        w: 8.5,
        h: 1.5,
        fontSize: 40,
        bold: true,
        color: white,
        fontFace: 'Segoe UI',
      });
      if (slide.subtitle) {
        s.addText(slide.subtitle, { x: 0.7, y: 3.3, w: 8, h: 0.8, fontSize: 18, color: 'CBD5E1' });
      }
      const subs = (slide.content || []).slice(0, 2);
      if (subs.length) {
        s.addText(subs.join(' · '), { x: 0.7, y: 4.2, w: 8, h: 0.6, fontSize: 14, color: '94A3B8' });
      }
      if (slide.notes) s.addNotes(slide.notes);
      return;
    }

    const s = pres.addSlide({ masterName: 'CONTENT' });
    s.addText(slide.title || '', {
      x: 0.5,
      y: 0.08,
      w: 9,
      h: 0.5,
      fontSize: 22,
      bold: true,
      color: white,
    });

    const bullets = (slide.content || []).slice(0, 5);
    if (bullets.length) {
      s.addText(
        bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.05, w: 4.4, h: 3.7, fontSize: 15, color: text, valign: 'top' },
      );
    }

    const v = slide.visual;
    if (v?.type === 'stats' && v.stats?.length) {
      const labels = v.stats.slice(0, 4).map((st) => st.label.slice(0, 24));
      const values = v.stats.slice(0, 4).map((st) => parseStatValue(st.value));
      s.addChart(
        pres.ChartType.bar,
        [{ name: v.caption || 'Statistika', labels, values }],
        {
          x: 5.0,
          y: 1.15,
          w: 4.5,
          h: 3.3,
          chartColors: [primary],
          showLegend: false,
          showTitle: false,
          valAxisMaxVal: Math.max(...values, 10) * 1.2,
        },
      );
    } else if (v?.type === 'flow' && v.steps?.length) {
      const steps = v.steps.slice(0, 4);
      s.addText(
        steps.map((st, i) => ({
          text: `${i + 1}. ${st.label}`,
          options: { bullet: false, breakLine: true, fontSize: 12 },
        })),
        {
          x: 5.0,
          y: 1.2,
          w: 4.5,
          h: 3.2,
          fontSize: 12,
          color: text,
          fill: { color: 'F1F5F9' },
          valign: 'top',
        },
      );
    } else if (v?.type === 'clinical' && v.vignette) {
      const lines = [
        v.vignette.patient,
        ...(v.vignette.findings || []).map((f) => `• ${f}`),
        v.vignette.question ? `? ${v.vignette.question}` : '',
      ].filter(Boolean);
      s.addText(lines.join('\n'), {
        x: 5.0,
        y: 1.2,
        w: 4.5,
        h: 3.2,
        fontSize: 12,
        color: text,
        fill: { color: 'EEF2FF' },
        valign: 'top',
      });
    } else {
      const visualHint =
        slide.keyTakeaway ||
        (slide.visual?.caption ?? '') ||
        (slide.mermaid ? '[Mermaid diagramma]' : `[${slide.visual?.type ?? 'vizual'}]`);
      s.addText(visualHint, {
        x: 5.0,
        y: 1.2,
        w: 4.5,
        h: 3.2,
        fontSize: 13,
        color: text,
        align: 'center',
        valign: 'middle',
        fill: { color: 'F1F5F9' },
      });
    }

    if (slide.keyTakeaway) {
      s.addText(slide.keyTakeaway, {
        x: 0.5,
        y: 4.85,
        w: 9,
        h: 0.45,
        fontSize: 11,
        italic: true,
        color: '64748B',
      });
    }

    const notes = [slide.notes, slide.imagePrompt ? `Rasm: ${slide.imagePrompt}` : ''].filter(Boolean).join('\n\n');
    if (notes) s.addNotes(notes);
  });

  const safeName = (topic || 'Taqdimot').replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'Taqdimot';
  await pres.writeFile({ fileName: `${safeName}.pptx` });
}
