import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Bike Spot",
    short_name: "Bike Spot",
    description: "Know where to park your bike before you get there.",
    lang: "en",
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#f3f1ea",
    theme_color: "#15150f",
    categories: ["navigation", "utilities", "travel"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
    shortcuts: [
      {
        name: "Map",
        short_name: "Map",
        description: "See the live map of your parking",
        url: "/map?source=shortcut",
        icons: [{ src: "/icons/shortcut-map.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Forecast",
        short_name: "Forecast",
        description: "Find the best time to arrive",
        url: "/forecast?source=shortcut",
        icons: [{ src: "/icons/shortcut-forecast.png", sizes: "96x96", type: "image/png" }],
      },
    ],
    screenshots: [
      { src: "/screenshots/home-phone.png", sizes: "780x1688", type: "image/png", form_factor: "narrow", label: "Where to park right now" },
      { src: "/screenshots/map-phone.png", sizes: "780x1688", type: "image/png", form_factor: "narrow", label: "Live map of every zone" },
      { src: "/screenshots/forecast-phone.png", sizes: "780x1688", type: "image/png", form_factor: "narrow", label: "Best time to arrive" },
      { src: "/screenshots/map-desktop.png", sizes: "1440x900", type: "image/png", form_factor: "wide", label: "Live map on a large screen" },
    ],
  };
}
