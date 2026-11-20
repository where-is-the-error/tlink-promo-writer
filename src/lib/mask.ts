/**
 * 브라우저 안에서만 도는 민감정보 가리기.
 * 원본 이미지는 서버로 보내지 않고, 가린 결과(Blob)만 업로드합니다.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'auto' | 'manual';
}

// 휴대폰, 지역번호, 070 번호. 1877-3836 같은 대표번호(0으로 시작하지 않음)는 대상이 아님.
const PHONE = /(01[016789]|070|0[2-6][0-9]?)[-.\s]?\d{3,4}[-.\s]?\d{4}/g;

type TesseractWorker = {
  recognize: (
    image: HTMLCanvasElement,
    options?: object,
    output?: object,
  ) => Promise<{data: {blocks: Array<{paragraphs: Array<{lines: Array<{words: Array<{text: string; bbox: {x0: number; y0: number; x1: number; y1: number}}>}>}>}> | null}}>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(async ({createWorker}) => (await createWorker('kor+eng')) as unknown as TesseractWorker);
  }
  return workerPromise;
}

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
}

/** OCR로 전화번호 위치를 찾아 상자 목록을 돌려줍니다. */
export async function findPhoneBoxes(img: HTMLImageElement): Promise<Box[]> {
  const worker = await getWorker();
  const {data} = await worker.recognize(imageToCanvas(img), {}, {blocks: true});
  const boxes: Box[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        // 단어를 이어 붙이며 각 단어의 문자 범위를 기록
        let text = '';
        const spans = line.words.map((w) => {
          const start = text.length;
          text += w.text;
          const span = {start, end: text.length, bbox: w.bbox};
          text += ' ';
          return span;
        });
        for (const m of text.matchAll(PHONE)) {
          const s = m.index ?? 0;
          const e = s + m[0].length;
          const hit = spans.filter((sp) => sp.start < e && sp.end > s);
          if (!hit.length) continue;
          const x0 = Math.min(...hit.map((h) => h.bbox.x0));
          const y0 = Math.min(...hit.map((h) => h.bbox.y0));
          const x1 = Math.max(...hit.map((h) => h.bbox.x1));
          const y1 = Math.max(...hit.map((h) => h.bbox.y1));
          const pad = 4;
          boxes.push({x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2, source: 'auto'});
        }
      }
    }
  }
  return boxes;
}

export function drawMasked(canvas: HTMLCanvasElement, img: HTMLImageElement, boxes: Box[], preview?: Box | null) {
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = '#111111';
  for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
  if (preview) {
    ctx.strokeStyle = '#c0262c';
    ctx.lineWidth = Math.max(2, img.naturalWidth / 400);
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
    ctx.setLineDash([]);
  }
}

/** 가린 최종 이미지(PNG) */
export async function exportMasked(img: HTMLImageElement, boxes: Box[]): Promise<Blob> {
  const c = document.createElement('canvas');
  drawMasked(c, img, boxes);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))), 'image/png'));
}
