import type { Slide } from '../../services/presentationTypes';

export async function exportDeckToPptx(topic: string, slides: Slide[]): Promise<void> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  pres.title = topic || 'Taqdimot';
  pres.layout = 'LAYOUT_16x9';

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
        y: 2,
        w: 8.5,
        h: 1.5,
        fontSize: 40,
        bold: true,
        color: white,
        fontFace: 'Segoe UI',
      });
      if (slide.subtitle) {
        s.addText(slide.subtitle, { x: 0.7, y: 3.5, w: 8, h: 0.8, fontSize: 18, color: 'CBD5E1' });
      }
      return;
    }

    const s = pres.addSlide({ masterName: 'CONTENT' });
    s.addText(slide.title || '', {
      x: 0.5,
      y: 0.08,
      w: 9,
      h: 0.5,
      fontSize: 24,
      bold: true,
      color: white,
    });

    const bullets = (slide.content || []).slice(0, 5);
    if (bullets.length) {
      s.addText(
        bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.1, w: 4.5, h: 3.6, fontSize: 16, color: text, valign: 'top' },
      );
    }

    const visualHint =
      slide.keyTakeaway ||
      (slide.visual?.caption ?? '') ||
      `[${slide.visual?.type ?? 'vizual'} diagramma]`;
    s.addText(visualHint, {
      x: 5.2,
      y: 1.2,
      w: 4.2,
      h: 3.4,
      fontSize: 14,
      color: text,
      align: 'center',
      valign: 'middle',
      fill: { color: 'F1F5F9' },
    });
  });

  await pres.writeFile({ fileName: `${(topic || 'Taqdimot').replace(/[^\w\s-]/g, '').slice(0, 60)}.pptx` });
}
