"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { ChevronRightIcon, DownloadIcon, FlaskIcon, ShieldIcon, StarIcon, TrashIcon, WrenchIcon } from "@/components/ui/Icons";
import { Card, Eyebrow, Segmented } from "@/components/ui/primitives";
import { useLive } from "@/hooks/useLive";
import { useIsIos, usePwa } from "@/hooks/usePwa";
import { MOCK_MODE } from "@/lib/api";
import type { Palette } from "@/lib/heat";
import { toggleFavorite, updateSettings, useSettings, type ThemeChoice } from "@/lib/settings";
import { clearLiveCache } from "@/lib/store";
import { IOS_INSTALL_HINT } from "./InstallCard";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow className="px-2">{title}</Eyebrow>
      <Card className="divide-y divide-border overflow-hidden">{children}</Card>
    </section>
  );
}

function LinkRow({ href, icon, label, hint }: { href: string; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <span className="text-muted">
        <ChevronRightIcon size={20} />
      </span>
    </Link>
  );
}

function InstallRow() {
  const { canPrompt, install, installed } = usePwa();
  const ios = useIsIos();
  const hint = installed
    ? "Installed on this device"
    : canPrompt
      ? "Works offline, opens full screen"
      : ios
        ? IOS_INSTALL_HINT
        : "Use your browser menu: Install app";

  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span className="text-muted">
        <DownloadIcon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Install Bike Spot</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      {canPrompt && (
        <button onClick={() => void install()} className="tap min-h-11 rounded-full bg-primary px-4 text-sm font-semibold text-primary-fg">
          Install
        </button>
      )}
    </div>
  );
}

function ClearDataRow() {
  const [cleared, setCleared] = useState(false);
  return (
    <button
      onClick={async () => {
        clearLiveCache();
        setCleared(true);
      }}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <span className="text-muted">
        <TrashIcon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Clear saved parking data</span>
        <span className="block text-sm text-muted" aria-live="polite">
          {cleared ? "Cleared. Fetching fresh data." : "Your preferences stay as they are"}
        </span>
      </span>
    </button>
  );
}

export function SettingsScreen() {
  const { theme, palette, favorites } = useSettings();
  const { items } = useLive();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <Eyebrow className="px-2">Appearance</Eyebrow>
            <Card className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2">
                <p className="font-medium">Theme</p>
                <Segmented<ThemeChoice>
                  label="Theme"
                  value={theme}
                  onChange={(v) => updateSettings({ theme: v })}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2">
                <p className="font-medium">Map colors</p>
                <Segmented<Palette>
                  label="Map colors"
                  value={palette}
                  onChange={(v) => updateSettings({ palette: v })}
                  options={[
                    { value: "standard", label: "Standard" },
                    { value: "safe", label: "Color-blind safe" },
                  ]}
                />
                <div
                  aria-hidden="true"
                  className="h-2.5 rounded-full"
                  style={{ background: "var(--chance-ramp)" }}
                />
              </div>
            </Card>
          </section>

          {items.length > 0 && (
            <Group title="Favorite parkings">
              {items.map((i) => {
                const on = favorites.includes(i.config.id);
                return (
                  <button
                    key={i.config.id}
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggleFavorite(i.config.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className={on ? "text-text" : "text-muted"}>
                      <StarIcon size={22} filled={on} />
                    </span>
                    <span className="flex-1 font-medium">{i.config.name}</span>
                    <span className="text-sm text-muted">{on ? "Preferred" : "Add"}</span>
                  </button>
                );
              })}
            </Group>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Group title="App">
            <InstallRow />
            <ClearDataRow />
          </Group>

          <Group title="About">
            <LinkRow href="/privacy" icon={<ShieldIcon size={22} />} label="Privacy" hint="What the cameras do with your data" />
            <LinkRow href="/admin" icon={<WrenchIcon size={22} />} label="Admin" hint="Zones and sensors" />
            {MOCK_MODE && <LinkRow href="/debug" icon={<FlaskIcon size={22} />} label="Demo controls" hint="Replay a day, force a zone full" />}
          </Group>

          <p className="px-2 text-sm text-muted">Bike Spot · build {process.env.NEXT_PUBLIC_BUILD_ID}</p>
        </div>
      </div>
    </>
  );
}
