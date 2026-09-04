/**
 * Access to Worker bindings from route handlers.
 *
 * Route handlers receive a plain Request, so they cannot reach the `env`
 * argument the Worker entry point is given. The entry point records it here on
 * every request instead. Module scope is per-isolate and set before any handler
 * runs, so a handler always reads the environment for the request it is serving.
 */
export interface RuntimeBindings {
  DATASET_CACHE?: KVNamespace;
  DB?: D1Database;
  /** This same Worker, bound as a service. See selfFetcher. */
  SELF?: { fetch(request: Request): Promise<Response> };
}

let bindings: RuntimeBindings = {};

/**
 * The request's own execution context, when the platform gave us one.
 *
 * A Worker cancels any promise still running when the response goes out, so
 * work that must outlive the answer — building a company after telling the
 * reader it is being built — has to be handed to `waitUntil`. Route handlers
 * never see it, so the entry point leaves it here beside the bindings.
 */
export interface RuntimeContext { waitUntil(promise: Promise<unknown>): void }

let context: RuntimeContext | null = null;

export function setRuntimeBindings(env: unknown, ctx?: RuntimeContext) {
  bindings = (env ?? {}) as RuntimeBindings;
  context = ctx ?? null;
}

/** Keeps background work alive past the response, where the platform allows. */
export function keepAlive(promise: Promise<unknown>) {
  const settled = promise.catch(() => { /* The caller reports its own failures. */ });
  if (context) context.waitUntil(settled);
  return settled;
}

/** The normalized-company cache, or null when running without the binding. */
export function datasetCache(): KVNamespace | null {
  return bindings.DATASET_CACHE ?? null;
}

/** The relational company/screener index, or null until D1 is configured. */
export function database(): D1Database | null {
  return bindings.DB ?? null;
}

/**
 * How to call this Worker's own endpoints from inside it.
 *
 * Not the global `fetch`. A Worker that fetches its own hostname does not
 * re-enter itself — Cloudflare passes the subrequest through to whatever sits
 * behind the Worker, which for this application is the static asset store. Every
 * such call therefore came back `404` for any `/api/...` path, which is why the
 * scheduled warm-up filled nothing while the very same URL answered `200` from
 * a browser. The service binding is the supported way to invoke yourself.
 *
 * Null when unbound, so callers can fall back to the global fetch — which is
 * correct under `vite dev`, where the dev server does re-enter itself.
 */
export function selfFetcher() {
  return bindings.SELF ?? null;
}
