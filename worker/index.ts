/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { warmWatchlist } from "../lib/dataset-cache";
import { setRuntimeBindings } from "../lib/runtime-env";

interface Env {
  ASSETS: Fetcher;
  /** Where the scheduled warm-up addresses its own endpoints. */
  SELF_ORIGIN?: string;
  DB: D1Database;
  DATASET_CACHE: KVNamespace;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledEvent { cron: string; scheduledTime: number }

const DEFAULT_ORIGIN = "https://finscope-financial-research.leoalaplage.workers.dev";

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Hand the bindings to route handlers, which only ever see a Request.
    setRuntimeBindings(env);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  /**
   * Rebuilds every watchlist company into the cache once a day.
   *
   * Without this the first reader after a cache expiry pays for normalizing a
   * company, and a reader loading the whole watchlist pays twenty-one times in
   * a row — which is what made "Load all" return a wall of 503s. Doing it on a
   * timer moves that cost to a moment when nobody is waiting, and leaves every
   * request users actually make on the warm path.
   *
   * Failures are logged, not thrown: a warm-up that partly succeeds is worth
   * far more than one that reports failure and leaves the cache empty.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    setRuntimeBindings(env);
    ctx.waitUntil((async () => {
      const started = Date.now();
      const report = await warmWatchlist(env.SELF_ORIGIN ?? DEFAULT_ORIGIN);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[warm ${event.cron}] ${report.warmed.length} warmed in ${seconds}s` +
        (report.failed.length ? `; ${report.failed.length} failed: ${report.failed.map((item) => `${item.ticker} (${item.reason})`).join(", ")}` : ""));
    })());
  },
};

export default worker;
