import type { Metadata } from "next";
import { LiveFeed } from "./live-feed";
import { activityFeed } from "@/lib/services/discover-service";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const initial = await activityFeed(60).catch(() => []);
  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Activity</p>
      <h1 className="text-gradient mt-3 text-4xl font-medium leading-tight md:text-5xl">What is happening across Vibe</h1>
      <p className="mt-3 max-w-xl text-fg-2">Launches, proof submissions, creator curve trades and graduations, as they are indexed. Every row links to its token and transaction.</p>
      <LiveFeed initial={initial} />
    </div>
  );
}
