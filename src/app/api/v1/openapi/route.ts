/** Stable public contract; additive fields allowed within v1, removals require a new major version. */
export function GET() {
  return Response.json(
    {
      openapi: "3.1.0",
      info: {
        title: "VibeProof evidence API",
        version: "1.0.0",
        description:
          "Evidence and observations, never an endorsement. Unknown values remain null. Public reads: 60/minute per trusted client IP; API credentials also consume plan monthly capacity. 429 denotes a limit. Mainnet and testnet are isolated.",
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: { developerKey: { type: "http", scheme: "bearer", bearerFormat: "vp_…" } },
        schemas: {
          Error: {
            type: "object",
            required: ["error"],
            properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
          },
          Evidence: {
            type: "object",
            required: ["source", "method", "observedAt"],
            properties: {
              source: { type: "string" },
              method: { type: "string" },
              observedAt: { type: "string", format: "date-time" },
              block: { type: "string" },
              network: { type: "string" },
            },
          },
          Meta: {
            type: "object",
            required: ["source", "observedAt", "cached"],
            properties: {
              source: { type: "string" },
              observedAt: { type: "string", format: "date-time" },
              cached: { type: "boolean" },
              demo: { type: "boolean" },
            },
          },
        },
      },
      paths: {
        "/api/v1/tokens/{address}": {
          get: {
            summary: "Network-specific token evidence passport",
            security: [{}, { developerKey: [] }],
            parameters: [
              { name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
              { name: "network", in: "query", schema: { type: "string", enum: ["robinhood-testnet", "robinhood-mainnet"] } },
            ],
            responses: {
              "200": { description: "{data,meta}; product checks include assurance, expiry and provenance. Activity values may be null." },
              "404": { description: "No observed contract" },
              "401": { description: "Invalid supplied developer credential" },
              "429": { description: "Rate or monthly quota exceeded" },
              "503": { description: "Required dependency unavailable" },
            },
          },
        },
        "/api/v1/discover": {
          get: {
            summary: "Paginated launches in descending immutable row ID order",
            security: [{}, { developerKey: [] }],
            parameters: [
              { name: "network", in: "query", schema: { type: "string", enum: ["robinhood-testnet", "robinhood-mainnet"] } },
              { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
              { name: "before", in: "query", schema: { type: "integer", minimum: 1 } },
              { name: "status", in: "query", schema: { type: "string", enum: ["bonding", "curve_completed", "graduated"] } },
            ],
            responses: {
              "200": { description: "{data:{items,nextBefore},meta}; each item carries chain, tx and block provenance" },
              "400": { description: "Invalid filter or pagination" },
              "429": { description: "Quota exceeded" },
              "503": { description: "Live data unavailable" },
            },
          },
        },
        "/api/proofs/verify": {
          get: {
            summary: "Reproduce a commitment using public blockchain and exact document bytes",
            parameters: [
              ...["txHash", "token", "creator"].map((name) => ({ name, in: "query", required: true, schema: { type: "string" } })),
              { name: "launchTx", in: "query", schema: { type: "string" } },
              { name: "network", in: "query", schema: { type: "string", enum: ["robinhood-testnet", "robinhood-mainnet"] } },
            ],
            responses: {
              "200": { description: "Verified commitment, authority status, confirmation policy, hash, URI, timestamp and explanation" },
              "409": { description: "Pending or insufficiently confirmed" },
              "422": { description: "Mismatched or reorganized evidence" },
              "503": { description: "Content, RPC, or configuration unavailable" },
            },
          },
        },
      },
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
