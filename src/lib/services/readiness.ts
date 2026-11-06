export type ReadinessNetwork = { rpc: { status: string; chainIdMatches: boolean | null }; indexer: { status: string } };
export function isReady(database: string, redis: string, networks: ReadinessNetwork[], production = process.env.NODE_ENV === "production") {
  return (
    database === "ok" &&
    (!production || redis === "ok") &&
    networks.length > 0 &&
    networks.every((n) => n.rpc.status === "ok" && n.rpc.chainIdMatches === true && ["healthy", "no_deployments"].includes(n.indexer.status))
  );
}
