import { z } from "zod";
import type { Address } from "viem";
import { getChainConfig } from "../chain/chains";
import { withRetry } from "../util/retry";
import { log, metrics } from "../util/log";

/** Thin, validated client for the Blockscout v2 REST API. Every method returns null on failure (never fake data). */

const base = () => getChainConfig()!.explorerApiUrl.replace(/\/api\/?$/, "") + "/api/v2";

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return await withRetry(
      async () => {
        metrics.inc("explorer.requests");
        const res = await fetch(base() + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404) return null;
        if (res.status === 429 || res.status >= 500) throw new Error(`explorer ${res.status}`);
        if (!res.ok) return null;
        const parsed = schema.safeParse(await res.json());
        if (!parsed.success) {
          log("warn", "explorer.schema_mismatch", { path, issues: parsed.error.issues.slice(0, 3) });
          return null;
        }
        return parsed.data;
      },
      { retries: 2 },
    );
  } catch (e) {
    metrics.inc("explorer.failures");
    log("warn", "explorer.failure", { path, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

const AbiItem = z.object({ type: z.string(), name: z.string().optional(), inputs: z.array(z.any()).optional(), stateMutability: z.string().optional() }).passthrough();

export const SmartContractSchema = z
  .object({
    is_verified: z.boolean().nullish(),
    is_fully_verified: z.boolean().nullish(),
    name: z.string().nullish(),
    compiler_version: z.string().nullish(),
    verified_at: z.string().nullish(),
    abi: z.array(AbiItem).nullish(),
    proxy_type: z.string().nullish(),
    implementations: z.array(z.object({ address_hash: z.string().optional(), address: z.string().optional(), name: z.string().nullish() })).nullish(),
  })
  .passthrough();

export const AddressSchema = z
  .object({
    hash: z.string(),
    is_contract: z.boolean().nullish(),
    is_verified: z.boolean().nullish(),
    creator_address_hash: z.string().nullish(),
    creation_transaction_hash: z.string().nullish(),
    creation_tx_hash: z.string().nullish(),
    proxy_type: z.string().nullish(),
    implementations: z.array(z.object({ address_hash: z.string().optional(), address: z.string().optional() })).nullish(),
    token: z.object({ holders_count: z.string().nullish(), holders: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();

export const TokenSchema = z
  .object({
    address_hash: z.string().optional(),
    address: z.string().optional(),
    name: z.string().nullish(),
    symbol: z.string().nullish(),
    decimals: z.string().nullish(),
    total_supply: z.string().nullish(),
    holders_count: z.string().nullish(),
    holders: z.string().nullish(),
    type: z.string().nullish(),
  })
  .passthrough();

const CountersSchema = z
  .object({ transactions_count: z.string().nullish(), token_transfers_count: z.string().nullish() })
  .passthrough();

const TxSchema = z
  .object({ hash: z.string(), block_number: z.number().nullish(), block: z.number().nullish(), timestamp: z.string().nullish(), from: z.object({ hash: z.string() }).passthrough() })
  .passthrough();

export const blockscout = {
  smartContract: (a: Address) => get(`/smart-contracts/${a}`, SmartContractSchema),
  address: (a: Address) => get(`/addresses/${a}`, AddressSchema),
  token: (a: Address) => get(`/tokens/${a}`, TokenSchema),
  tokenCounters: (a: Address) => get(`/tokens/${a}/counters`, z.object({ token_holders_count: z.string().nullish(), transfers_count: z.string().nullish() }).passthrough()),
  addressCounters: (a: Address) => get(`/addresses/${a}/counters`, CountersSchema),
  transaction: (h: string) => get(`/transactions/${h}`, TxSchema),
};

export type BlockscoutSmartContract = z.infer<typeof SmartContractSchema>;
