import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-32 text-center">
      <p className="label">404</p>
      <h1 className="text-gradient mt-3 text-2xl font-medium">Nothing observable here</h1>
      <p className="mt-3 text-fg-2">The address may be malformed, or there is no contract at it on Robinhood Chain Testnet.</p>
      <Link href="/discover" className="mt-8 inline-block text-sm text-accent hover:underline">
        Browse launches →
      </Link>
    </div>
  );
}
