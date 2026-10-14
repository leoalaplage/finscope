/**
 * The first sheet of an .xlsx workbook, as rows of strings.
 *
 * An issuer's daily holdings file is a spreadsheet (lib/adapters/ssga.ts), and
 * a Worker has no file system and no spreadsheet library: an .xlsx is a zip of
 * XML documents, so this reads the zip's central directory, inflates the two
 * documents a sheet needs with the platform's own DecompressionStream, and
 * reads the cells. Numbers stay as the text the file holds; the caller decides
 * what each column is.
 */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every entry of a zip archive, by name, inflated. */
export async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // The end of central directory record: its signature, searched from the end.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error("Not a zip archive.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    out.set(name, decoder.decode(method === 8 ? await inflate(raw) : raw));
  }
  return out;
}

const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The first worksheet's rows, each cell as its text (shared strings resolved), blanks kept in place. */
export async function readFirstSheet(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buffer, (name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet1\.xml$/.test(name));
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((match) => unescape([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
  const sheet = files.get("xl/worksheets/sheet1.xml") ?? "";
  const column = (reference: string) => {
    const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
    return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  };
  return [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const reference = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      const body = cell[2] ?? "";
      const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
      const text = /\bt="s"/.test(attributes) ? shared[Number(value)] ?? "" : unescape(value);
      cells[reference ? column(reference) : cells.length] = text;
    }
    return Array.from({ length: cells.length }, (_, index) => cells[index] ?? "");
  });
}
