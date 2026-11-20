import { PDFDocument } from "pdf-lib";

export interface ScannedPage {
  page_no: number;
  text: string;
  /** 사람 눈에 안 보이는 글자(1pt 이하, 쪽 영역 밖, 렌더링 모드 '보이지 않음') */
  hidden: string[];
}

/**
 * pdfjs로 쪽별 텍스트를 뽑고, 좌표·크기·렌더링 모드로 숨은 글자를 찾는다.
 * 흰 글씨(배경과 같은 색)는 렌더링 + OCR 비교가 필요해 여기서는 잡지 않는다.
 * 그 경우는 지시문 판별(6-5)과 로컬 등록 스크립트의 OCR 비교가 맡는다.
 */
export async function scanPdf(bytes: Uint8Array): Promise<ScannedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true })
    .promise;
  const pages: ScannedPage[] = [];

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const content = await page.getTextContent();
    const hidden: string[] = [];
    let text = "";

    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : "");
      const str = item.str.trim();
      if (!str) continue;
      const [, , c, d, x, y] = item.transform as number[];
      const fontSize = Math.hypot(c, d);
      const offPage = x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1;
      if (fontSize <= 1 || offPage) hidden.push(str);
    }

    // 텍스트 렌더링 모드 3(보이지 않음)으로 그린 글자
    const ops = await page.getOperatorList();
    const stack: number[] = [];
    let mode = 0;
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === pdfjs.OPS.save) stack.push(mode);
      else if (fn === pdfjs.OPS.restore) mode = stack.pop() ?? 0;
      else if (fn === pdfjs.OPS.setTextRenderingMode) mode = Number(ops.argsArray[i]?.[0] ?? 0);
      else if (fn === pdfjs.OPS.showText && mode === 3) {
        const glyphs = (ops.argsArray[i]?.[0] ?? []) as unknown[];
        const str = glyphs
          .map((g) => (g && typeof g === "object" && "unicode" in g ? String((g as { unicode: string }).unicode) : ""))
          .join("")
          .trim();
        if (str) hidden.push(str);
      }
    }

    pages.push({ page_no: n, text: text.trim(), hidden: [...new Set(hidden)] });
  }
  await doc.loadingTask.destroy();
  return pages;
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
}

/** 원본에서 `keep`(1-기준 쪽 번호)만 남긴 PDF를 만든다. 카드 생성에 격리 쪽을 넣지 않기 위해 쓴다. */
export async function keepPages(bytes: Uint8Array, keep: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, keep.map((p) => p - 1));
  for (const p of copied) out.addPage(p);
  return out.save();
}
