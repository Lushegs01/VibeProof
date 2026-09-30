import { route, ok } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { issueNonce } from "@/lib/auth/session";

export const GET = route("auth_nonce", { limit: 20 }, async () => ok({ nonce: await issueNonce() }, baseMeta("VibeProof")));
