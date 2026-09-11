/**
 * One file out of a ZIP archive, and nothing more.
 *
 * The Bank of England publishes its daily gilt curve only as spreadsheets in a
 * ZIP — and a spreadsheet is itself a ZIP of XML — so reading one number means
 * opening two archives. A general library for that would be most of a
 * megabyte in a Worker that needs to find two or three files by name.
 *
 * Read from the central directory at the end rather than by walking the local
 * headers from the start, because the local headers of a streamed archive can
 * leave their sizes blank and the directory never does. Stored and deflated
 * entries only: those are the two methods every spreadsheet writer uses, and
 * anything else is refused by name rather than decoded as noise.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  offset: number;
}

/** Every entry the archive's directory lists. */
export function zipEntries(archive: ArrayBuffer): ZipEntry[] {
  const view = new DataView(archive);
  // The end record is at least 22 bytes and may be followed by a comment of up
  // to 65,535; it is found by walking back from the end for its signature.
  let end = -1;
  for (let at = archive.byteLength - 22; at >= Math.max(0, archive.byteLength - 22 - 65_535); at--) {
    if (view.getUint32(at, true) === EOCD) { end = at; break; }
  }
  if (end < 0) throw new Error("Not a ZIP archive: no end-of-directory record.");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error("A ZIP directory entry is malformed.");
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    entries.push({
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      offset: view.getUint32(at + 42, true),
      name: decoder.decode(new Uint8Array(archive, at + 46, nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The bytes of the first entry whose name matches, or null if none does. */
export async function readZipEntry(archive: ArrayBuffer, match: (name: string) => boolean): Promise<Uint8Array | null> {
  const entry = zipEntries(archive).find((each) => match(each.name));
  if (!entry) return null;
  const view = new DataView(archive);
  if (view.getUint32(entry.offset, true) !== LOCAL) throw new Error(`The ZIP entry ${entry.name} is malformed.`);
  // The local header repeats the name and may carry a different extra field,
  // so the data starts where the local header says, not where the directory's
  // copy of it would put it.
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = new Uint8Array(archive, start, entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (entry.method === 8) return inflate(data);
  throw new Error(`The ZIP entry ${entry.name} uses compression method ${entry.method}, which is not read here.`);
}

/** The same, as text. */
export async function readZipText(archive: ArrayBuffer, match: (name: string) => boolean): Promise<string | null> {
  const bytes = await readZipEntry(archive, match);
  return bytes ? new TextDecoder().decode(bytes) : null;
}
