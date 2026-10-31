export type Palette = "standard" | "safe";

// Where the ramp reaches ok and good; a "Quiet" zone (60%+) must already read as green.
// Keep in sync with --chance-ramp in app/globals.css.
const OK_AT = 0.4;
const GOOD_AT = 0.75;

/** A zone no camera can currently see: grey, not a good or a bad colour. */
export const UNKNOWN_COLOR = "var(--chance-unknown)";

/** CSS color for an estimated share of free spots: bad (0) through ok to good; grey when unknown. */
export function chanceColor(p: number | null): string {
  if (p === null) return UNKNOWN_COLOR;
  const c = Math.min(1, Math.max(0, p));
  if (c < OK_AT) return `color-mix(in oklab, var(--chance-bad), var(--chance-ok) ${Math.round((c / OK_AT) * 100)}%)`;
  const t = Math.min(1, (c - OK_AT) / (GOOD_AT - OK_AT));
  return `color-mix(in oklab, var(--chance-ok), var(--chance-good) ${Math.round(t * 100)}%)`;
}
