# Bike Spot — frontend

Installable Next.js PWA (App Router, strict TypeScript, Tailwind) that tells cyclists where to park right now. The UI is English only.

## Run

```bash
bun install
bun run dev                      # http://localhost:3000, simulated data, no config needed
bun run build && bun run start   # production (the service worker only runs here)
bun run lint
bun test                         # logic: geometry, opening hours, recommendation, trends, forecast
```

## Screens

| Route | Purpose |
|---|---|
| `/` | Parkings: the recommendation, today's outlook, one card per parking |
| `/map` | Live map and zones; deep links with `?p=<parking>&z=<zone>` |
| `/forecast` | Best time to arrive, day curve, week matrix; `?p=<parking>` |
| `/settings` | Theme, color-blind palette, favorites, install, saved data |
| `/admin` | Key figures, zones and sensors, draw a new zone on the plan (drafts, JSON export) |
| `/privacy` | The data flow from camera to screen |
| `/debug` | Mock mode only: replay a day, force a zone full or empty, latency, network cut |

## Mock vs real backend

In `.env.local` (restart after changing):

| Variable | Effect |
|---|---|
| `MOCK_MODE=true` | default: the client calls the built-in mock routes under `/api` |
| `MOCK_MODE=false` | the client calls `NEXT_PUBLIC_API_URL` (CORS required); the mock routes answer 404 |
| `MOCK_HOUR=9` | optional: starts the simulated clock at that hour on a working Tuesday |

The switch lives in `lib/api.ts`.

## API contract

The schema comes from `code/types/parkingLotConfig.ts` and `code/types/parkingHeatmap.ts`, mirrored in `lib/types.ts` (keep both in sync). Coordinates are in metres.

The endpoints are **assumptions** until the backend confirms them (they live in `lib/api.ts` and `lib/mock.ts`):

- `GET /api/parkings` returns `ParkingLotConfig[]`. Refreshed every 5 minutes.
- `GET /api/parkings/:id/heatmap` returns `ParkingHeatmap`. Polled every 5 s while the app is visible, with backoff on errors.

How the UI reads the data:

- A zone's chance is the mean probability of the grid cells inside its polygon; a parking's is the same, weighted by zone area.
- Levels: 60%+ Quiet, 30%+ Busy, below that Nearly full.
- The recommendation only considers open parkings. Favorites win a near-tie, and the current pick is held through a near-tie so it doesn't flicker.
- The payload has no timestamp, so "Updated Xs ago" is measured from the last successful fetch on the client.

**Forecast and admin figures are simulated** (`lib/forecast.ts`) until the backend provides history. The UI labels them as such.

## Code layout

- `lib/store.ts`: the single live-data store (polling, backoff, offline copy). `hooks/useLive.ts` derives what screens need.
- `lib/*`: pure logic, unit tested in `lib/logic.test.ts`.
- `components/<screen>/`, plus `shell/` (navigation, status, PWA prompts) and `ui/` (primitives).

## Theming

All colors are CSS variables in `app/globals.css`, with dark variants and a color-blind palette, mapped into Tailwind (`bg-surface`, `text-muted`...). Neutrals are ink and paper; color is reserved for the chance of a spot. If you change `--chance-*`, update `RAMPS` in `lib/heat.ts`.

Icons: `bun scripts/gen-icons.mjs`. App screenshots used by the install dialog live in `public/screenshots/`.

## PWA

- `public/sw.js` precaches every page and the assets they reference, so the whole app works offline. It never caches `/api/*`: the store keeps its own timestamped copy, so stale data is always shown as stale.
- Each build gets an id (`next.config.ts`). The app compares it with `/version.json` when it returns to the foreground, installs the new worker in the background and offers a reload.
- Install: native prompt where supported, instructions on iOS.

## Not possible without the backend

Push alerts ("a spot freed up"), saving zones from `/admin`, admin authentication, real forecasts, and directions to a parking (the schema has no GPS coordinates).
