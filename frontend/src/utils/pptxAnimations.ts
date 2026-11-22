/**
 * PPTX ga slayd o'tishlari va animatsiyalar (2026-10-21).
 *
 * Shikoyat: "animatsiya va effektlar ishlamayapti". Taqdimot `pptxgenjs` bilan
 * yig'iladi, u esa animatsiyani umuman qo'llamaydi. Shuning uchun tayyor fayl
 * ichidagi slayd XML'iga to'g'ridan-to'g'ri qo'shiladi:
 *  - har slaydga yumshoq o'tish (fade);
 *  - sarlavhadan pastdagi kontent QATORMA-QATOR bosilganda paydo bo'ladi
 *    (fade), bir slaydda ko'pi bilan 5 bosish — o'qituvchi tushuntirib boradi.
 * Sarlavha, yuqori yorliq va pastki kolontitul animatsiyasiz (darhol ko'rinadi).
 */
import JSZip from 'jszip';

const EMU_PER_INCH = 914400;
/** Kontent zonasi (LAYOUT_WIDE 13.33×7.5 dyuym): sarlavhadan past, kolontituldan yuqori. */
// Sarlavha, uning ostidagi mis chiziq (1.54") va izoh qatori (1.68") animatsiyasiz.
const CONTENT_TOP = 1.8 * EMU_PER_INCH;
const CONTENT_BOTTOM = 6.85 * EMU_PER_INCH;
const MAX_CLICKS = 5;

type Shape = { id: number; x: number; y: number; w: number; h: number };

/** Slayddagi animatsiya qilinadigan shakllar (matnli/shaklli `p:sp` va jadval). */
export function contentShapes(xml: string): Shape[] {
  const out: Shape[] = [];
  const re = /<p:(sp|graphicFrame)>([\s\S]*?)<\/p:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const body = m[2];
    const id = Number(body.match(/<p:cNvPr[^>]*\bid="(\d+)"/)?.[1]);
    const off = body.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/);
    const ext = body.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
    const x = Number(off?.[1]);
    const y = Number(off?.[2]);
    if (!Number.isFinite(id) || !Number.isFinite(y)) continue;
    if (y < CONTENT_TOP || y > CONTENT_BOTTOM) continue;
    out.push({ id, x: Number.isFinite(x) ? x : 0, y, w: Number(ext?.[1]) || 0, h: Number(ext?.[2]) || 0 });
  }
  return out;
}

const TOUCH = 0.04 * EMU_PER_INCH;
const THIN = 0.03 * EMU_PER_INCH;
/** Shu balandlikdan baland bo'lak (masalan "asosiy fikr" paneli) — alohida, birinchi. */
const BACKDROP_H = 2.5 * EMU_PER_INCH;

const overlaps = (a: Shape, b: Shape) =>
  a.x < b.x + b.w + TOUCH && b.x < a.x + a.w + TOUCH && a.y < b.y + b.h + TOUCH && b.y < a.y + a.h + TOUCH;

/**
 * Bosish guruhlari. Ustma-ust shakllar bitta bo'lak (kartochka: ramka, chiziq,
 * raqam, matn — birga chiqadi); ingichka ajratuvchi eng yaqin bo'lakka qo'shiladi;
 * baland bo'lak (panel) birinchi chiqadi; qolganlari balandlikda kesishsa bitta
 * qatorga (bir qatordagi kartochkalar birga), qatorlar — ko'pi bilan
 * `MAX_CLICKS` ta bosishga.
 */
export function clickGroups(input: Array<Pick<Shape, 'id' | 'y'> & Partial<Shape>>): number[][] {
  const shapes: Shape[] = input.map((s) => ({ x: 0, w: 0, h: 0, ...s }));
  const lines = shapes.filter((s) => Math.min(s.w, s.h) < THIN && Math.max(s.w, s.h) > 0);
  const solid = shapes.filter((s) => !lines.includes(s));
  // Ustma-ust shakllar — bitta bo'lak (union-find).
  const parent = solid.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) if (overlaps(solid[i], solid[j])) parent[root(j)] = root(i);
  }
  const clusters = new Map<number, Shape[]>();
  solid.forEach((s, i) => clusters.set(root(i), [...(clusters.get(root(i)) ?? []), s]));
  const blocks = [...clusters.values()].map((members) => {
    const top = Math.min(...members.map((s) => s.y));
    const bottom = Math.max(...members.map((s) => s.y + s.h));
    return { ids: members.map((s) => s.id), top, bottom, mid: (top + bottom) / 2 };
  });
  // Ingichka chiziq 0.3" ichidagi eng yaqin bo'lakka; uzoqda bo'lsa — o'zi.
  const gapTo = (b: { top: number; bottom: number }, y: number) => (y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0);
  for (const line of lines) {
    const mid = line.y + line.h / 2;
    const near = [...blocks].sort((a, b) => gapTo(a, mid) - gapTo(b, mid))[0];
    if (near && gapTo(near, mid) <= 0.3 * EMU_PER_INCH) near.ids.push(line.id);
    else blocks.push({ ids: [line.id], top: line.y, bottom: line.y + line.h, mid });
  }
  const backdrops = blocks.filter((b) => b.bottom - b.top >= BACKDROP_H).sort((a, b) => a.top - b.top);
  const rest = blocks.filter((b) => !backdrops.includes(b)).sort((a, b) => a.top - b.top);
  const rows: number[][] = backdrops.map((b) => b.ids);
  let rowBottom = -Infinity;
  for (const b of rest) {
    // Joriy qator bilan balandlikda kesishsa — shu qator (yonma-yon kartochkalar, marker va matn).
    if (b.top < rowBottom - TOUCH && rows.length > backdrops.length) {
      rows[rows.length - 1].push(...b.ids);
      rowBottom = Math.max(rowBottom, b.bottom);
    } else {
      rows.push([...b.ids]);
      rowBottom = b.bottom;
    }
  }
  // Hammasi bitta bo'lak (jadval: ustun foni barcha qatorlarni qoplaydi) — qatorma-qator, yuqori chegarasi bo'yicha.
  return capClicks(rows.length >= 2 ? rows : rowsByTop(shapes));
}

function rowsByTop(shapes: Shape[]): number[][] {
  const step = 0.3 * EMU_PER_INCH;
  const rows = new Map<number, number[]>();
  for (const s of [...shapes].sort((a, b) => a.y - b.y)) {
    const key = Math.round(s.y / step);
    rows.set(key, [...(rows.get(key) ?? []), s.id]);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
}

function capClicks(rows: number[][]): number[][] {
  if (rows.length <= MAX_CLICKS) return rows;
  const groups: number[][] = Array.from({ length: MAX_CLICKS }, () => []);
  rows.forEach((ids, i) => groups[Math.floor((i * MAX_CLICKS) / rows.length)].push(...ids));
  return groups.filter((g) => g.length);
}

/** `<p:timing>`: har guruh — bitta bosish, ichidagi shakllar birga (fade). */
export function timingXml(groups: number[][]): string {
  let id = 3;
  const next = () => id++;
  const clicks = groups
    .map((ids) => {
      const outer = next();
      const inner = next();
      const effects = ids
        .map((spid, k) => {
          const node = next();
          const set = next();
          const fade = next();
          return (
            `<p:par><p:cTn id="${node}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" ` +
            `nodeType="${k === 0 ? 'clickEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
            `<p:set><p:cBhvr><p:cTn id="${set}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
            `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>` +
            `</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>` +
            `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${fade}" dur="500"/>` +
            `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>` +
            `</p:childTnLst></p:cTn></p:par>`
          );
        })
        .join('');
      return (
        `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
        `<p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>` +
        `${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`
      );
    })
    .join('');
  const build = groups
    .flat()
    .map((spid) => `<p:bldP spid="${spid}" grpId="0" animBg="1"/>`)
    .join('');
  return (
    '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>' +
    '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>' +
    clicks +
    '</p:childTnLst></p:cTn>' +
    '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>' +
    '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>' +
    '</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>' +
    `<p:bldLst>${build}</p:bldLst></p:timing>`
  );
}

const TRANSITION = '<p:transition spd="med"><p:fade/></p:transition>';

/** Bitta slayd XML'i: o'tish va (kontent bo'lsa) animatsiya qo'shilgan nusxa. */
export function animateSlideXml(xml: string, { animate = true } = {}): string {
  if (/<p:transition\b|<p:timing\b/.test(xml) || !xml.includes('</p:sld>')) return xml;
  const groups = animate ? clickGroups(contentShapes(xml)) : [];
  const timing = groups.length >= 2 ? timingXml(groups) : '';
  // Tartib (ECMA-376): cSld, clrMapOvr, transition, timing, extLst.
  const ext = xml.lastIndexOf('<p:extLst>');
  const at = ext > xml.lastIndexOf('</p:cSld>') ? ext : xml.lastIndexOf('</p:sld>');
  return `${xml.slice(0, at)}${TRANSITION}${timing}${xml.slice(at)}`;
}

/** Tayyor PPTX: barcha slaydlarga o'tish, birinchi slayddan tashqari — animatsiya. */
export async function addSlideAnimations(pptx: Blob): Promise<Blob> {
  // Baytlar orqali: Blob'ni JSZip brauzerda o'qiydi, Node'da (sinov) — yo'q.
  const zip = await JSZip.loadAsync(new Uint8Array(await pptx.arrayBuffer()));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const name of names) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async('string');
    const first = name === 'ppt/slides/slide1.xml';
    zip.file(name, animateSlideXml(xml, { animate: !first }));
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
