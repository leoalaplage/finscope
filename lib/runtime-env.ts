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
}

let bindings: RuntimeBindings = {};

export function setRuntimeBindings(env: unknown) {
  bindings = (env ?? {}) as RuntimeBindings;
}

/** The normalized-company cache, or null when running without the binding. */
export function datasetCache(): KVNamespace | null {
  return bindings.DATASET_CACHE ?? null;
}
