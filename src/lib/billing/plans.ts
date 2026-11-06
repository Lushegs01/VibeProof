/** Capacity only: no paid plan can change evidence or verification results. */
export const PLANS = {
  free: { watchlist: 20, apiMonthly: 1000, webhooks: 0, historyExport: false },
  professional: { watchlist: 500, apiMonthly: 50000, webhooks: 5, historyExport: true },
  developer: { watchlist: 1000, apiMonthly: 500000, webhooks: 25, historyExport: true },
  enterprise: { watchlist: 10000, apiMonthly: 5000000, webhooks: 100, historyExport: true },
} as const;
export type Plan = keyof typeof PLANS;
export type SubscriptionState = "inactive" | "trialing" | "active" | "past_due" | "canceled";
export function effectivePlan(plan: string, state: string): Plan {
  return (state === "active" || state === "trialing") && plan in PLANS ? (plan as Plan) : "free";
}
export interface BillingAdapter {
  checkout(wallet: string, plan: Exclude<Plan, "free">): Promise<{ mode: "test" | "live"; reference: string; url: string | null }>;
}
/** No entitlement mutation or charge; production provider must implement authenticated callbacks. */
export class TestBillingAdapter implements BillingAdapter {
  async checkout(_wallet: string, plan: Exclude<Plan, "free">) {
    return { mode: "test" as const, reference: `test:${plan}:${crypto.randomUUID()}`, url: null };
  }
}
