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
| `MOCK_MODE=false` | the Next.js server proxies `/api/v1/*` to `BACKEND_INTERNAL_URL`; the mock routes answer 404 |
| `MOCK_HOUR=9` | optional: starts the simulated clock at that hour on a working Tuesday |

The switch lives in `lib/api.ts`.

## API contract

The schema comes from `code/types/parkingLotConfig.ts` and `code/types/parkingOccupancy.ts`, mirrored in `lib/types.ts` (keep both in sync). Plan coordinates are in metres, camera polygons normalized to 0..1. See `documentation/api.md`.

- `GET /api/v1/parkings` returns `ParkingLotConfig[]`. Refreshed every 5 minutes.
- `GET /api/v1/parkings/:id/occupancy` returns `ParkingOccupancy`. Polled every 5 s while the app is visible, with backoff on errors.
- `POST /api/v1/cameras/:id/calibration-capture` returns the anonymized view for the setup wizard.

The mock routes answer the same under `/api`.

How the UI reads the data:

- A zone's chance is `1 - occupancy`; a parking's is the same, weighted by capacity over the zones with a measurement.
- A zone without one is shown in grey as "No live data". It is neither free nor full, and it's never recommended.
- Levels: 60%+ Quiet, 30%+ Busy, below that Nearly full.
- The recommendation only considers open parkings. Favorites win a near-tie, and the current pick is held through a near-tie so it doesn't flicker.
- "Updated Xs ago" is measured from the last successful fetch on the client; a stale measurement is already `unknown` on the server.

**The forecast is simulated** (`lib/forecast.ts`) until the backend provides history.

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
