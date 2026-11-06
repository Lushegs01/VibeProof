import { z } from "zod";
import { route, ok, fail } from "@/lib/api/response";
import { baseMeta } from "@/lib/api/params";
import { sessionWallet } from "@/lib/auth/request";
import { accountUsage } from "@/lib/billing/entitlements";
import { PLANS, TestBillingAdapter } from "@/lib/billing/plans";
export const GET = route("account", {}, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in to view usage.");
  return ok({ ...(await accountUsage(wallet.toLowerCase())), plans: PLANS, billingMode: "test" }, baseMeta("Account usage counters"));
});
export const POST = route("account_checkout", { limit: 5 }, async (req) => {
  const wallet = await sessionWallet(req);
  if (!wallet) return fail(401, "unauthenticated", "Sign in first.");
  const input = z.object({ plan: z.enum(["professional", "developer", "enterprise"]) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return fail(400, "invalid_plan", "Unknown plan.");
  return ok(await new TestBillingAdapter().checkout(wallet, input.data.plan), baseMeta("Test billing adapter; no payment or plan change occurs"));
});
