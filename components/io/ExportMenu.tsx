"use client";

import { useState } from "react";

export type ExportCell = string | number | boolean | null | undefined;
export type ExportRow = Record<string, ExportCell>;

const encode = new TextEncoder();

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const quote = (value: ExportCell) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function table(rows: ExportRow[], provenance: string[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const values: ExportCell[][] = [
    ["FinScope export"],
    ["Exported at", new Date().toISOString()],
    ...provenance.map((source) => ["Source", source]),
    [],
    columns,
    ...rows.map((row) => columns.map((column) => row[column])),
  ];
  return { columns, values };
}

export function buildCsv(rows: ExportRow[], provenance: string[]) {
  return `\uFEFF${table(rows, provenance).values.map((row) => row.map(quote).join(",")).join("\r\n")}`;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);

/** A standards-compliant, uncompressed ZIP container: enough for a real XLSX without a runtime dependency. */
function zip(files: Array<{ name: string; body: string }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encode.encode(file.name), body = encode.encode(file.body), crc = crc32(body);
    const local = new Uint8Array(30 + name.length + body.length), localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50); u16(localView, 4, 20); u32(localView, 14, crc); u32(localView, 18, body.length); u32(localView, 22, body.length); u16(localView, 26, name.length);
    local.set(name, 30); local.set(body, 30 + name.length); chunks.push(local);
    const directory = new Uint8Array(46 + name.length), directoryView = new DataView(directory.buffer);
    u32(directoryView, 0, 0x02014b50); u16(directoryView, 4, 20); u16(directoryView, 6, 20); u32(directoryView, 16, crc); u32(directoryView, 20, body.length); u32(directoryView, 24, body.length); u16(directoryView, 28, name.length); u32(directoryView, 42, offset);
    directory.set(name, 46); central.push(directory); offset += local.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50); u16(endView, 8, files.length); u16(endView, 10, files.length); u32(endView, 12, centralSize); u32(endView, 16, offset);
  const total = [...chunks, ...central, end], output = new Uint8Array(total.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0; for (const chunk of total) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const columnName = (index: number) => { let result = "", cursor = index + 1; while (cursor) { cursor--; result = String.fromCharCode(65 + cursor % 26) + result; cursor = Math.floor(cursor / 26); } return result; };

export function buildXlsx(rows: ExportRow[], provenance: string[]) {
  const values = table(rows, provenance).values;
  const sheetRows = values.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    return typeof cell === "number" && Number.isFinite(cell)
      ? `<c r="${ref}"><v>${cell}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${xml(cell == null ? "" : String(cell))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return zip([
    { name: "[Content_Types].xml", body: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
    { name: "_rels/.rels", body: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", body: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="FinScope" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", body: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", body: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
}

const ascii = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "-");
const pdfEscape = (value: string) => ascii(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");

export function buildPdf(rows: ExportRow[], provenance: string[]): Uint8Array {
  const lines = table(rows, provenance).values.flatMap((row) => {
    const line = row.map((cell) => cell == null ? "" : String(cell)).join("  |  ");
    return line ? Array.from({ length: Math.ceil(line.length / 105) }, (_, index) => line.slice(index * 105, (index + 1) * 105)) : [""];
  });
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 48)) }, (_, index) => lines.slice(index * 48, (index + 1) * 48));
  const objects: string[] = ["", "<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageRefs: number[] = [];
  pages.forEach((page) => {
    const pageId = objects.length, contentId = pageId + 1; pageRefs.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = `BT /F1 8 Tf 36 756 Td 0 -14 TD ${page.map((line) => `(${pdfEscape(line)}) Tj T*`).join(" ")} ET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[2] = `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((id) => `${id} 0 R`).join(" ")}] >>`;
  let document = "%PDF-1.4\n"; const offsets = [0];
  for (let id = 1; id < objects.length; id++) { offsets[id] = document.length; document += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = document.length;
  document += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encode.encode(document);
}

const blobBytes = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.length); copy.set(bytes); return copy.buffer;
};

export function ExportMenu({ name, rows, provenance }: { name: string; rows: ExportRow[]; provenance: string[] }) {
  const [message, setMessage] = useState("");
  const safe = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "finscope-export";
  const exported = (format: string) => { setMessage(`${format} ready`); setTimeout(() => setMessage(""), 1_500); };
  return (
    <div className="export-menu" aria-label="Export with provenance">
      <span className="label">Export</span>
      <button type="button" onClick={() => { download(`${safe}.csv`, new Blob([buildCsv(rows, provenance)], { type: "text/csv;charset=utf-8" })); exported("CSV"); }}>CSV</button>
      <button type="button" onClick={() => { download(`${safe}.xlsx`, new Blob([blobBytes(buildXlsx(rows, provenance))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); exported("XLSX"); }}>XLSX</button>
      <button type="button" onClick={() => { download(`${safe}.pdf`, new Blob([blobBytes(buildPdf(rows, provenance))], { type: "application/pdf" })); exported("PDF"); }}>PDF</button>
      <span className="export-status" aria-live="polite">{message}</span>
    </div>
  );
}
