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
  /** This same Worker, bound as a service. See selfFetcher. */
  SELF?: { fetch(request: Request): Promise<Response> };
}

let bindings: RuntimeBindings = {};

export function setRuntimeBindings(env: unknown) {
  bindings = (env ?? {}) as RuntimeBindings;
}

/** The normalized-company cache, or null when running without the binding. */
export function datasetCache(): KVNamespace | null {
  return bindings.DATASET_CACHE ?? null;
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
