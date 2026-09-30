import type { Metadata } from "next";
import { WatchlistView } from "./watchlist-view";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 md:px-6 md:pt-14">
      <p className="label">Watchlist</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Tokens you are watching</h1>
      <p className="mt-3 text-fg-2">Stored in this browser only. Wallet-linked watchlists are on the roadmap.</p>
      <WatchlistView />
    </div>
  );
}
