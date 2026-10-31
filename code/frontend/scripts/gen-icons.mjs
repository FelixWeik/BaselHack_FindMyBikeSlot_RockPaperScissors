// Generates the PWA icons: `bun scripts/gen-icons.mjs`
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const INK = "#15150f";
const PAPER = "#fbfaf5";
const SPOT = "#12a150";

// A bike whose front wheel is the free spot, in green.
const bike = (stroke, spot) => `
  <g fill="none" stroke="${stroke}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="148" cy="330" r="74"/>
    <path d="M148 330 L222 196 L334 196 L268 330 Z M222 196 L204 156 M172 156 H236 M334 196 L322 150 H366 M334 196 L364 330"/>
  </g>
  <circle cx="364" cy="330" r="86" fill="${spot}"/>
  <circle cx="364" cy="330" r="26" fill="${stroke}"/>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;
const rounded = `<rect width="512" height="512" rx="116" fill="${INK}"/>`;
const full = `<rect width="512" height="512" fill="${INK}"/>`;
const inset = (body, scale) => {
  const offset = (512 * (1 - scale)) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>`;
};

const render = (markup, size, path) => sharp(Buffer.from(svg(markup))).resize(size).png().toFile(path);

const shortcut = (glyph) => `${rounded}
  <g fill="none" stroke="${PAPER}" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`;

await mkdir("public/icons", { recursive: true });

const icon = rounded + inset(bike(PAPER, SPOT), 0.92);
await writeFile("public/icons/favicon.svg", svg(icon));
await render(icon, 192, "public/icons/icon-192.png");
await render(icon, 512, "public/icons/icon-512.png");
await render(full + inset(bike(PAPER, SPOT), 0.92), 180, "public/icons/apple-touch-icon.png");
// Maskable icons keep their content inside the central 80% safe zone.
await render(full + inset(bike(PAPER, SPOT), 0.72), 512, "public/icons/maskable-512.png");
await render(inset(bike("#ffffff", "#ffffff"), 0.72), 512, "public/icons/monochrome-512.png");
await render(
  shortcut(`<path d="M256 440s-130-112-130-210a130 130 0 0 1 260 0c0 98-130 210-130 210Z"/><circle cx="256" cy="230" r="44"/>`),
  96,
  "public/icons/shortcut-map.png",
);
await render(
  shortcut(`<path d="M104 104v304h304"/><path d="M168 320l76-92 56 44 92-120"/>`),
  96,
  "public/icons/shortcut-forecast.png",
);
console.log("icons generated");
