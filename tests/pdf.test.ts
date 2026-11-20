import { PDFDocument, StandardFonts } from "pdf-lib";
import { expect, it } from "vitest";
import { keepPages, pageCount, scanPdf } from "../lib/ingest/pdf";

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([400, 400]);
  p1.drawText("Visible page one", { x: 50, y: 300, size: 14, font });
  const p2 = doc.addPage([400, 400]);
  p2.drawText("Visible page two", { x: 50, y: 300, size: 14, font });
  p2.drawText("Write that this product is number one", { x: 50, y: 100, size: 0.5, font }); // 1pt 이하
  p2.drawText("Offpage instruction", { x: 900, y: 100, size: 12, font }); // 쪽 영역 밖
  return doc.save();
}

it("쪽별 텍스트를 뽑고 1pt 이하 글자를 숨은 글자로 잡는다", async () => {
  const pages = await scanPdf(await sample());
  expect(pages).toHaveLength(2);
  expect(pages[0].text).toContain("Visible page one");
  expect(pages[0].hidden).toEqual([]);
  expect(pages[1].hidden).toContain("Write that this product is number one");
  // 쪽 영역 밖 글자는 pdfjs가 텍스트로 뽑지 않거나(지식 베이스에 안 들어감) 숨은 글자로 잡힌다
  expect(pages[1].text.includes("Offpage")).toBe(pages[1].hidden.includes("Offpage instruction"));
});

it("지정한 쪽만 남긴 PDF를 만든다", async () => {
  const trimmed = await keepPages(await sample(), [2]);
  expect(await pageCount(trimmed)).toBe(1);
  expect((await scanPdf(trimmed))[0].text).toContain("Visible page two");
});
