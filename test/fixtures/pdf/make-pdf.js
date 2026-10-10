// make-pdf.js — writes minimal valid PDFs (Helvetica text, one content stream per page) for the tests.
// A page is an array of ASCII lines. Byte offsets in the xref table are computed, so pdf.js reads them strictly.
import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s).replace(/[\\()]/g, "\\$&");

export function makePdf(pages) {
  const n = pages.length;
  const last = 3 + 2 * n;
  const objs = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${n} >>`,
    3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  };
  pages.forEach((lines, i) => {
    const stream = `BT /F1 10 Tf 12 TL 40 760 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
    objs[5 + 2 * i] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objs[4 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id <= last; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${last + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= last; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${last + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Writes the PDF into dir (created if needed) and returns its path.
export function writePdf(dir, name, pages) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, makePdf(pages));
  return file;
}
