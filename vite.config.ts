import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Normalized companies live here between requests. See
// app/api/company/[ticker]/route.ts for why this binding exists.
const DATASET_CACHE_NAMESPACE_ID = "eca2a833a69b478f944cf1a6f1efc4b2";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // Rebuild every watchlist company into KV at 07:00 UTC, after the SEC has
  // published overnight and before anyone is likely to be reading. See the
  // scheduled handler in worker/index.ts for why this exists.
  //
  // The three later runs are not about freshness — a dataset is good for a
  // week. They are there because Cloudflare does not guarantee a cron fires,
  // and a run that is skipped or dies halfway used to mean nobody noticed until
  // someone opened the site and found it empty. Each later run is a no-op when
  // the morning's succeeded: a cached company is skipped without being read.
  triggers: { crons: ["0 7,13,19,1 * * *"] },
  kv_namespaces: [{ binding: "DATASET_CACHE", id: DATASET_CACHE_NAMESPACE_ID }],
  // How the warm-up reaches this Worker's own endpoints. A plain
  // `fetch("https://this-worker/api/company/X")` does *not* re-enter the
  // Worker: Cloudflare sends a self-addressed subrequest to the origin behind
  // it, which here is the static asset store, so every warm fetch came back
  // 404 and the cache was never filled by the timer at all. A service binding
  // is the supported way to invoke yourself, and it keeps the property the
  // design wants — a real second invocation with its own CPU budget.
  services: [{ binding: "SELF", service: "finscope-financial-research" }],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
