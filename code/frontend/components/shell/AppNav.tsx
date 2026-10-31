"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ForecastIcon, MapIcon, ParkingsIcon, SettingsIcon } from "@/components/ui/Icons";

const TABS = [
  { href: "/map", label: "Map", Icon: MapIcon },
  { href: "/forecast", label: "Forecast", Icon: ForecastIcon },
  { href: "/", label: "Parkings", Icon: ParkingsIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

// Secondary pages keep their parent tab lit.
const PARENT: Record<string, string> = { "/admin": "/settings", "/privacy": "/settings", "/debug": "/settings" };

export function AppNav() {
  const pathname = usePathname();
  const current = PARENT[pathname] ?? pathname;
  const index = TABS.findIndex((t) => t.href === current);

  return (
    <nav
      aria-label="Main"
      className="app-nav fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:inset-y-0 lg:left-0 lg:right-auto lg:w-24 lg:border-r lg:border-border lg:bg-surface lg:p-0"
    >
      <ul className="relative mx-auto flex max-w-md rounded-full bg-[var(--nav-bg)] p-1.5 shadow-nav backdrop-blur-xl lg:h-full lg:w-full lg:flex-col lg:justify-center lg:gap-2 lg:rounded-none lg:bg-transparent lg:px-2 lg:shadow-none lg:backdrop-blur-none">
        {index >= 0 && (
          <li
            aria-hidden="true"
            className="absolute inset-y-1.5 left-1.5 w-[calc((100%-0.75rem)/4)] rounded-full bg-primary transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] lg:hidden"
            style={{ transform: `translateX(${index * 100}%)` }}
          />
        )}
        {TABS.map(({ href, label, Icon }, i) => {
          const active = i === index;
          return (
            <li key={href} className="relative flex-1 lg:flex-none">
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-full text-[0.6875rem] font-semibold transition-colors lg:mx-auto lg:size-20 lg:rounded-3xl ${
                  active ? "text-primary-fg lg:bg-primary" : "text-muted hover:text-text"
                }`}
              >
                <Icon size={22} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
