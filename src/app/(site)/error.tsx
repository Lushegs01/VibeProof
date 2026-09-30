"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-32 text-center">
      <p className="label">Unavailable</p>
      <h1 className="mt-3 text-2xl font-semibold">This page could not be assembled</h1>
      <p className="mt-3 text-fg-2">A data source (RPC, explorer or database) did not respond. Nothing is shown rather than showing something wrong.</p>
      <button type="button" onClick={reset} className="mt-8 rounded-md border border-line px-4 py-2 text-sm hover:border-line-strong">
        Try again
      </button>
    </div>
  );
}
