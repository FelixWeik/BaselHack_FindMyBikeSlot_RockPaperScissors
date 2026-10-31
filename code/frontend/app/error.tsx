"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="font-display text-[2rem] font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted">Your saved data is safe. Try loading this screen again.</p>
      <button onClick={reset} className="tap min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-fg">
        Try again
      </button>
    </div>
  );
}
