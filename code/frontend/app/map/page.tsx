import { Suspense } from "react";
import { MapScreen } from "@/components/map/MapScreen";
import { MapSkeleton } from "@/components/ui/primitives";

export const metadata = { title: "Map" };

export default function MapPage() {
  return (
    <Suspense fallback={<MapSkeleton />}>
      <MapScreen />
    </Suspense>
  );
}
