"use client";

/** Back and next, with the reasons next is disabled right above it. */
export function StepNav({ issues, onBack, onNext, nextLabel = "Next" }: { issues: string[]; onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="grid gap-3">
      {issues.length > 0 && (
        <ul aria-live="polite" className="grid gap-1 text-sm text-muted">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="tap min-h-12 flex-1 rounded-full bg-surface-2 font-semibold">
          Back
        </button>
        <button type="button" disabled={issues.length > 0} onClick={onNext} className="tap min-h-12 flex-1 rounded-full bg-primary font-semibold text-primary-fg disabled:opacity-40">
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
