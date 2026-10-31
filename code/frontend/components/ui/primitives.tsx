import type { ComponentProps } from "react";
import { chanceColor } from "@/lib/heat";
import { TREND_LABEL, type Trend } from "@/lib/recommend";
import { ArrowDownIcon, ArrowFlatIcon, ArrowUpIcon } from "./Icons";

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-[1.75rem] bg-surface shadow-card ${className}`} {...props} />;
}

export function Eyebrow({ className = "", ...props }: ComponentProps<"p">) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.08em] text-muted ${className}`} {...props} />;
}

export function SectionTitle({ className = "", ...props }: ComponentProps<"h2">) {
  return <h2 className={`font-display text-xl font-semibold tracking-tight ${className}`} {...props} />;
}

export function Gauge({ chance, label, className = "" }: { chance: number; label?: string; className?: string }) {
  const pct = Math.round(chance * 100);
  return (
    <div
      role={label ? "meter" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? pct : undefined}
      aria-valuetext={label ? `${pct}% chance of a spot` : undefined}
      className={`h-2 overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      <div className="gauge-fill h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: chanceColor(chance) }} />
    </div>
  );
}

export function TrendLabel({ trend, className = "" }: { trend: Trend | null; className?: string }) {
  if (!trend) return null;
  const Icon = trend === "up" ? ArrowUpIcon : trend === "down" ? ArrowDownIcon : ArrowFlatIcon;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Icon size={14} />
      {TREND_LABEL[trend]}
    </span>
  );
}

export function Sparkline({ values, label, className = "" }: { values: number[]; label?: string; className?: string }) {
  if (values.length < 3) return null;
  const W = 100;
  const H = 28;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * W},${H - 2 - v * (H - 4)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    >
      <polyline points={points} fill="none" stroke={chanceColor(last)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-[1.75rem] bg-surface-2 ${className}`} />;
}

export function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-64" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

export function MapSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-[44dvh]" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-full px-3 text-sm font-medium transition-colors ${
            o.value === value ? "bg-surface shadow-card" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
