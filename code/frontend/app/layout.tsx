import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import { ViewTransition } from "react";
import { AppNav } from "@/components/shell/AppNav";
import { PwaPrompts } from "@/components/shell/PwaPrompts";
import { themeScript } from "@/lib/themeScript";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });

const description = "Know where to park your bike before you get there.";

export const metadata: Metadata = {
  title: { default: "Bike Spot", template: "%s · Bike Spot" },
  description,
  applicationName: "Bike Spot",
  appleWebApp: { capable: true, title: "Bike Spot", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#0f100c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${bricolage.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full bg-bg font-sans text-text">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <div className="lg:pl-24">
          <main
            id="main"
            className="mx-auto w-full max-w-2xl px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:px-6 lg:max-w-6xl lg:pb-12 lg:pt-8"
          >
            <ViewTransition>{children}</ViewTransition>
          </main>
        </div>
        <AppNav />
        <PwaPrompts />
      </body>
    </html>
  );
}
