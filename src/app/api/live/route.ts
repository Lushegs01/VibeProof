/** Liveness makes no claim about data freshness or dependencies. */
export function GET() {
  return Response.json({ status: "alive" }, { headers: { "cache-control": "no-store" } });
}
