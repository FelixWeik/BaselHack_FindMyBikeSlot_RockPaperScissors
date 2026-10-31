import { LiveStatus } from "./LiveStatus";

interface Props {
  title: React.ReactNode;
  eyebrow?: string;
  /** Show the live connection pill; only meaningful on screens with live data. */
  live?: boolean;
}

export function PageHeader({ title, eyebrow, live }: Props) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-medium text-muted">{eyebrow}</p>}
        <h1 className="font-display text-[2rem] font-bold leading-[1.1] tracking-tight">{title}</h1>
      </div>
      {live && <LiveStatus />}
    </header>
  );
}
