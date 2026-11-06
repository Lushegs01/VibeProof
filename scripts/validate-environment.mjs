/** Pre-release validation; prints missing variable NAMES only, never values. */
const missing = [];
for (const key of ["NEXT_PUBLIC_APP_URL", "SESSION_SECRET", "CRON_SECRET"]) if (!process.env[key]) missing.push(key);
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) missing.push("DATABASE_URL or POSTGRES_URL");
if (!process.env.REDIS_URL && !process.env.KV_URL) missing.push("REDIS_URL or KV_URL");
if ((process.env.SESSION_SECRET?.length ?? 0) < 32) missing.push("SESSION_SECRET (32+ characters)");
if ((process.env.CRON_SECRET?.length ?? 0) < 16) missing.push("CRON_SECRET (16+ characters)");
try {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    missing.push("NEXT_PUBLIC_APP_URL (HTTPS origin)");
} catch {
  missing.push("NEXT_PUBLIC_APP_URL (valid URL)");
}
if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") missing.push("NEXT_PUBLIC_DEMO_MODE must be false for production");
if (!["database", "ipfs"].includes(process.env.EVIDENCE_STORAGE ?? "database")) missing.push("EVIDENCE_STORAGE (database or ipfs)");
if (process.env.EVIDENCE_STORAGE === "ipfs" && !process.env.IPFS_WRITE_API) missing.push("IPFS_WRITE_API");
if (process.env.ALERT_WEBHOOK_URL) {
  try {
    const url = new URL(process.env.ALERT_WEBHOOK_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
      missing.push("ALERT_WEBHOOK_URL (public HTTPS receiver without credentials/query/fragment)");
  } catch {
    missing.push("ALERT_WEBHOOK_URL (valid URL)");
  }
  if ((process.env.ALERT_WEBHOOK_SECRET?.length ?? 0) < 32) missing.push("ALERT_WEBHOOK_SECRET (32+ characters)");
}
if (missing.length) {
  console.error("Production configuration invalid:\n" + [...new Set(missing)].map((k) => `- ${k}`).join("\n"));
  process.exitCode = 1;
} else console.log("Required production configuration is present. Run readiness probes against staging before release.");
