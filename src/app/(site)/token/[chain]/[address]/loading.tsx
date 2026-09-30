export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-14 md:px-6" aria-busy aria-label="Loading passport">
      <div className="skeleton h-3 w-32" />
      <div className="skeleton mt-5 h-12 w-64" />
      <div className="skeleton mt-3 h-5 w-48" />
      <div className="mt-8 grid grid-cols-2 gap-px md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-none" />
        ))}
      </div>
      <div className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-14" />
        ))}
      </div>
      <div className="skeleton mt-10 h-72" />
    </div>
  );
}
