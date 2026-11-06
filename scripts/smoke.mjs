const origin = new URL(process.env.VIBEPROOF_URL ?? "http://localhost:3000");
for (const path of ["/api/live", "/api/ready", "/api/v1/openapi"]) {
  const r = await fetch(new URL(path, origin), { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Smoke failed: ${path} HTTP ${r.status}`);
  const body = await r.json();
  if (path === "/api/ready" && body.status !== "ready") throw new Error("Stale or unavailable indexing dependencies");
  console.log(`${path} passed`);
}
