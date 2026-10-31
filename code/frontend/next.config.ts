import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones on the same network load dev assets (without this the page never hydrates).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "100.*.*.*", "*.local"],
  // The client reads NEXT_PUBLIC_MOCK_MODE; MOCK_MODE (.env.local) stays the source of truth.
  env: {
    NEXT_PUBLIC_MOCK_MODE: process.env.MOCK_MODE ?? "true",
    NEXT_PUBLIC_BUILD_ID: Date.now().toString(36),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
