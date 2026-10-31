import { Suspense } from "react";
import { ForecastScreen } from "@/components/forecast/ForecastScreen";
import { MapSkeleton } from "@/components/ui/primitives";

export const metadata = { title: "Forecast" };

export default function ForecastPage() {
  return (
    <Suspense fallback={<MapSkeleton />}>
      <ForecastScreen />
    </Suspense>
  );
}
