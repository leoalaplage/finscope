import { v1Meta, type V1Envelope, type V1ErrorCode, type V1ErrorEnvelope, type V1Meta } from "./contracts";

export const V1_CACHE = {
  search: "public, s-maxage=86400, stale-while-revalidate=604800",
  financials: "public, s-maxage=3600, stale-while-revalidate=86400",
  quotes: "public, s-maxage=30, stale-while-revalidate=120",
  screener: "public, s-maxage=300, stale-while-revalidate=3600",
  none: "no-store",
} as const;

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function entityTag(body: string): string {
  return `W/"${body.length.toString(16)}-${fnv1a(body)}"`;
}

export function jsonResponse(
  request: Request,
  payload: unknown,
  options: { status?: number; cacheControl?: string; headers?: HeadersInit } = {},
): Response {
  const body = JSON.stringify(payload);
  const etag = entityTag(body);
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", options.cacheControl ?? V1_CACHE.none);
  headers.set("ETag", etag);
  headers.set("Vary", "Accept-Encoding");

  if ((options.status ?? 200) === 200 && request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: options.status ?? 200, headers });
}

export function v1Response<T>(
  request: Request,
  data: T,
  meta: Partial<Omit<V1Meta, "schemaVersion">>,
  options: { status?: number; cacheControl?: string; headers?: HeadersInit } = {},
): Response {
  const payload: V1Envelope<T> = { meta: v1Meta(meta), data };
  return jsonResponse(request, payload, options);
}

export function v1Error(
  request: Request,
  status: number,
  code: V1ErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    details?: V1ErrorEnvelope["error"]["details"];
    meta?: Partial<Omit<V1Meta, "schemaVersion">>;
    headers?: HeadersInit;
  } = {},
): Response {
  const payload: V1ErrorEnvelope = {
    meta: v1Meta({ status: "unavailable", warnings: [message], ...options.meta }),
    error: { code, message, retryable: options.retryable ?? status >= 500, details: options.details },
  };
  return jsonResponse(request, payload, { status, cacheControl: V1_CACHE.none, headers: options.headers });
}

