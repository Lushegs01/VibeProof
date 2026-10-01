"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-32 text-center">
      <p className="label">Unavailable</p>
      <h1 className="text-gradient mt-3 text-2xl font-medium">This page could not be assembled</h1>
      <p className="mt-3 text-fg-2">A data source (RPC, explorer or database) did not respond. Nothing is shown rather than showing something wrong.</p>
      <button type="button" onClick={reset} className="btn btn-outline mt-8 h-11 px-6">
        Try again
      </button>
    </div>
  );
}
