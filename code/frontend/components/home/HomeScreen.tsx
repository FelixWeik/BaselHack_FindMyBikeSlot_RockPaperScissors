"use client";

import { InstallCard } from "@/components/settings/InstallCard";
import { PageHeader } from "@/components/shell/PageHeader";
import { NoParkings, StaleNotice, UnreachableState } from "@/components/shell/LiveStatus";
import { ListSkeleton, SectionTitle } from "@/components/ui/primitives";
import { useLive, useRecommendation } from "@/hooks/useLive";
import { useSettings } from "@/lib/settings";
import { NowHero } from "./NowHero";
import { OutlookStrip } from "./OutlookStrip";
import { ParkingCard } from "./ParkingCard";

export function HomeScreen() {
  const { items, loading, unreachable } = useLive();
  const { favorites } = useSettings();
  const recommendation = useRecommendation(items, favorites);

  // Favorites first, otherwise a stable order: cards must not jump around between polls.
  const ordered = [...items].sort(
    (a, b) => Number(favorites.includes(b.config.id)) - Number(favorites.includes(a.config.id)),
  );

  return (
    <>
      <PageHeader title="Parkings" live />
      <StaleNotice />
      {unreachable ? (
        <UnreachableState />
      ) : loading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        <NoParkings />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
          <div className="flex flex-col gap-4">
            {recommendation && <NowHero recommendation={recommendation} />}
            {recommendation?.kind === "go" && <OutlookStrip item={recommendation.item} />}
            <InstallCard />
          </div>
          <section aria-labelledby="all-parkings" className="flex flex-col gap-3">
            <SectionTitle id="all-parkings" className="lg:sr-only">
              All parkings
            </SectionTitle>
            {ordered.map((i) => (
              <ParkingCard key={i.config.id} item={i} favorite={favorites.includes(i.config.id)} />
            ))}
          </section>
        </div>
      )}
    </>
  );
}
