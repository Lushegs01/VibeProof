import { isDemoMode } from "../demo/mode";
import { developerWallet } from "./keys";
import { consumeApiUsage } from "../billing/entitlements";
import { ProofError } from "../services/proof-service";
/** Anonymous public access retains IP limits; supplied credentials must be valid and accounted. */
export async function accountApiRequest(req: Request) {
  if (!req.headers.has("authorization")) return null;
  if (isDemoMode()) throw new ProofError(403, "demo_mode", "Live credentials are not used in demo mode.");
  const wallet = await developerWallet(req);
  if (!wallet) throw new ProofError(401, "invalid_api_key", "Developer credential is invalid or revoked.");
  return consumeApiUsage(wallet);
}
