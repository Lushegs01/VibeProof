import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { ProofSubmissionSchema } from "@/lib/proof/metadata";
import { submitProof, ProofError } from "@/lib/services/proof-service";
import { readCookie, readSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { rateLimit } from "@/lib/cache/ratelimit";
import { isDemoMode } from "@/lib/demo/mode";

export const POST = route("proofs", { limit: 20 }, async (req) => {
  if (isDemoMode()) return fail(403, "demo_mode", "Submissions are disabled in demo mode.");
  const address = readSessionToken(readCookie(req, SESSION_COOKIE));
  if (!address) return fail(401, "unauthenticated", "Sign in with your wallet first.");
  if (!(await rateLimit(`proofs:wallet:${address}`, 10, 3600)).ok) return fail(429, "rate_limited", "Too many submissions from this wallet.");
  const body = await req.json().catch(() => null);
  const parsed = ProofSubmissionSchema.safeParse(body);
  if (!parsed.success) return fail(400, "invalid_body", "Invalid submission.", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  try {
    return ok(await submitProof(address, parsed.data), baseMeta("VibeProof proof checks"), { status: 201 });
  } catch (e) {
    if (e instanceof ProofError) return fail(e.status, e.code, e.message);
    throw e;
  }
});
