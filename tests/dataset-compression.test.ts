import { describe, expect, it } from "vitest";
import { getDatasetStream, getDatasetText, putDataset } from "../lib/dataset-cache";

/** A store that keeps what it is given, metadata and all, as KV does. */
function memoryStore() {
  const held = new Map<string, { value: ArrayBuffer | string; metadata: unknown }>();
  const stream = (value: ArrayBuffer | string) => new Blob([value]).stream();
  return {
    held,
    async put(key: string, value: ArrayBuffer | string, options?: { metadata?: unknown }) { held.set(key, { value, metadata: options?.metadata ?? null }); },
    async get(key: string) { const entry = held.get(key); return entry ? stream(entry.value) : null; },
    async getWithMetadata(key: string) { const entry = held.get(key); return { value: entry ? stream(entry.value) : null, metadata: entry?.metadata ?? null }; },
  } as unknown as KVNamespace & { held: Map<string, { value: ArrayBuffer | string; metadata: unknown }> };
}

describe("a dataset kept gzipped", () => {
  const dataset = JSON.stringify({ ticker: "AAPL", name: "Apple Inc. — Ünïcode", values: Array.from({ length: 2000 }, (_, at) => ({ end: "2026-06-30", value: at * 1.5 })) });

  it("is a fraction of its size in the store, and reads back the same text", async () => {
    const store = memoryStore();
    await putDataset(store, "company:v47:AAPL", dataset);
    const entry = store.held.get("company:v47:AAPL")!;
    expect(entry.metadata).toEqual({ encoding: "gzip" });
    expect((entry.value as ArrayBuffer).byteLength).toBeLessThan(dataset.length / 5);
    expect(await getDatasetText(store, "company:v47:AAPL")).toBe(dataset);
    expect(await new Response(await getDatasetStream(store, "company:v47:AAPL")).text()).toBe(dataset);
  });

  it("still reads a copy kept before, as it was", async () => {
    const store = memoryStore();
    await store.put("company:v46:AAPL", dataset);
    expect(await getDatasetText(store, "company:v46:AAPL")).toBe(dataset);
    expect(await getDatasetText(store, "company:v46:MSFT")).toBeNull();
  });
});
