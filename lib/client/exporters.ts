/**
 * 승인된 글을 블록으로 펼치고, 텍스트·Markdown·HTML·PDF로 내보냅니다.
 *
 * 사진 배치는 AI가 아니라 아래 규칙으로 정합니다 (2026-11-20 결정).
 *  1) 그 사진을 출처로 쓴 문장 바로 뒤
 *  2) 없으면, 그 사진에서 고른 카드를 출처로 쓴 첫 문장 뒤
 *  3) 둘 다 없으면 글 끝 "추가 사진"
 * 같은 문장 뒤에 여러 장이면 가이드라인 사진 순서(photos.orderIndex)대로 놓고,
 * 사진 번호는 본문에 나오는 순서대로 1부터 매깁니다.
 */
import {zipSync, strToU8} from 'fflate';
import {SECTION_TITLE} from './labels';
import type {Photo, PostDetail} from './types';

export type Block =
  | {type: 'title'; text: string}
  | {type: 'heading'; text: string}
  | {type: 'paragraph'; text: string}
  | {type: 'photo'; no: number; photo: Photo}
  | {type: 'extraPhotosHeading'}
  | {type: 'footer'; lines: string[]}
  | {type: 'hashtags'; tags: string[]};

export const photoMarker = (no: number) => `[여기에 ${no}번 사진 넣기]`;

/** 사진 id → 그 사진을 붙일 문장 id (없으면 null = 글 끝) */
export function placePhotos(d: PostDetail): Map<string, string | null> {
  const live = d.sentences.filter((s) => !s.deleted);
  const placement = new Map<string, string | null>();
  for (const photo of d.photos) {
    const own = live.find((s) => s.sourceType === 'photo' && s.sourceRef === photo.id);
    if (own) {
      placement.set(photo.id, own.id);
      continue;
    }
    const codes = new Set(
      d.choices
        .filter((c) => c.photoId === photo.id && c.selected)
        .map((c) => d.cards.find((card) => card.id === c.cardId)?.code)
        .filter(Boolean) as string[],
    );
    const byCard = live.find((s) => s.sourceType === 'card' && codes.has(s.sourceRef));
    placement.set(photo.id, byCard?.id ?? null);
  }
  return placement;
}

export function buildBlocks(d: PostDetail): Block[] {
  const photos = [...d.photos].sort((a, b) => a.orderIndex - b.orderIndex);
  const placement = placePhotos(d);
  const afterSentence = new Map<string, Photo[]>();
  const extras: Photo[] = [];
  for (const p of photos) {
    const at = placement.get(p.id);
    if (at) afterSentence.set(at, [...(afterSentence.get(at) ?? []), p]);
    else extras.push(p);
  }

  const blocks: Block[] = [{type: 'title', text: d.post.title ?? '(제목 없음)'}];
  const live = d.sentences.filter((s) => !s.deleted).sort((a, b) => a.sectionNo - b.sectionNo || a.orderNo - b.orderNo);
  for (let n = 1; n <= 5; n++) {
    const list = live.filter((s) => s.sectionNo === n);
    if (!list.length) continue;
    blocks.push({type: 'heading', text: SECTION_TITLE[n].replace(/^[①-⑤]\s*/, '')});
    let para: string[] = [];
    for (const s of list) {
      para.push(s.text);
      const attached = afterSentence.get(s.id);
      if (attached?.length) {
        blocks.push({type: 'paragraph', text: para.join(' ')});
        para = [];
        for (const p of attached) blocks.push({type: 'photo', no: 0, photo: p});
      }
    }
    if (para.length) blocks.push({type: 'paragraph', text: para.join(' ')});
  }
  if (extras.length) {
    blocks.push({type: 'extraPhotosHeading'});
    for (const p of extras) blocks.push({type: 'photo', no: 0, photo: p});
  }
  blocks.push({type: 'footer', lines: d.post.footerLines});
  if (d.post.hashtags.length) blocks.push({type: 'hashtags', tags: d.post.hashtags});
  // 번호는 본문에 나오는 순서대로 1, 2, 3 …
  let no = 0;
  for (const b of blocks) if (b.type === 'photo') b.no = ++no;
  return blocks;
}

// ─────────────── 텍스트 ───────────────
export function toText(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'title') out.push(b.text, '');
    else if (b.type === 'heading') out.push(b.text, '');
    else if (b.type === 'paragraph') out.push(b.text, '');
    else if (b.type === 'photo') out.push(photoMarker(b.no), '');
    else if (b.type === 'extraPhotosHeading') out.push('추가 사진', '');
    else if (b.type === 'footer') out.push(...b.lines, '');
    else if (b.type === 'hashtags') out.push(b.tags.join(' '));
  }
  return out.join('\n').trim() + '\n';
}

// ─────────────── Markdown ───────────────
const imageFileName = (b: {no: number; photo: Photo}) => {
  const ext = (b.photo.fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png').toLowerCase();
  return `images/${String(b.no).padStart(2, '0')}${ext}`;
};

/** withImages=false: 사진 자리에 "[여기에 N번 사진 넣기]" / true: images/ 폴더의 실제 사진 */
export function toMarkdown(blocks: Block[], withImages: boolean): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === 'title') out.push(`# ${b.text}`, '');
    else if (b.type === 'heading') out.push(`## ${b.text}`, '');
    else if (b.type === 'paragraph') out.push(b.text, '');
    else if (b.type === 'photo')
      out.push(withImages && b.photo.url ? `![${b.no}번 사진](${imageFileName(b)})` : `> ${photoMarker(b.no)}`, '');
    else if (b.type === 'extraPhotosHeading') out.push('## 추가 사진', '');
    else if (b.type === 'footer') out.push('---', '', ...b.lines.map((l) => `${l}  `), '');
    else if (b.type === 'hashtags') out.push(b.tags.join(' '));
  }
  return out.join('\n').trim() + '\n';
}

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Markdown + images/ 폴더를 zip 하나로 */
export async function toMarkdownZip(blocks: Block[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {'post.md': strToU8(toMarkdown(blocks, true))};
  for (const b of blocks) {
    if (b.type !== 'photo' || !b.photo.url) continue;
    const bytes = await fetchBytes(b.photo.url);
    if (bytes) files[imageFileName(b)] = bytes;
  }
  const zipped = zipSync(files);
  return new Blob([zipped.buffer as ArrayBuffer], {type: 'application/zip'});
}

// ─────────────── HTML / PDF ───────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 사진을 data URI로 품은 독립 HTML 한 파일 (커뮤니티 HTML 편집기·PDF 인쇄용) */
export async function toHtml(blocks: Block[]): Promise<string> {
  const title = blocks.find((b) => b.type === 'title');
  const body: string[] = [];
  for (const b of blocks) {
    if (b.type === 'title') body.push(`<h1>${esc(b.text)}</h1>`);
    else if (b.type === 'heading') body.push(`<h2>${esc(b.text)}</h2>`);
    else if (b.type === 'paragraph') body.push(`<p>${esc(b.text)}</p>`);
    else if (b.type === 'photo') {
      const src = b.photo.url ? await toDataUrl(b.photo.url) : null;
      body.push(
        src
          ? `<figure><img src="${src}" alt="${b.no}번 사진"><figcaption>${b.no}번 사진</figcaption></figure>`
          : `<p class="marker">${esc(photoMarker(b.no))}</p>`,
      );
    } else if (b.type === 'extraPhotosHeading') body.push('<h2>추가 사진</h2>');
    else if (b.type === 'footer') body.push(`<hr><p class="footer">${b.lines.map(esc).join('<br>')}</p>`);
    else if (b.type === 'hashtags') body.push(`<p class="tags">${esc(b.tags.join(' '))}</p>`);
  }
  // 내보내는 문서 자체의 스타일 (앱 UI가 아님)
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title?.type === 'title' ? title.text : '홍보글')}</title>
<style>
body{font-family:"Noto Sans KR",-apple-system,"Segoe UI",sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.8;color:#111}
h1{font-size:1.6em;line-height:1.4}h2{font-size:1.2em;margin-top:2em}
figure{margin:1.5em 0}img{max-width:100%;border-radius:8px}figcaption{font-size:.85em;color:#666}
.marker{padding:12px;border:1px dashed #999;border-radius:8px;color:#555}
.footer,.tags{font-size:.9em;color:#555}
@media print{body{margin:0 auto}}
</style></head><body>
${body.join('\n')}
</body></html>`;
}

/** 브라우저 인쇄 대화상자로 PDF 저장 (한글 글꼴이 그대로 유지됨) */
export async function printAsPdf(blocks: Block[]) {
  const html = await toHtml(blocks);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0'});
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 300));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
}

export function download(content: string | Blob, fileName: string, type = 'text/plain;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], {type}) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
