"use client";

import { PageHeader } from "@/components/shell/PageHeader";
import { UnreachableState } from "@/components/shell/LiveStatus";
import { ListSkeleton } from "@/components/ui/primitives";
import { useLive } from "@/hooks/useLive";
import { ZonesAdmin } from "./ZonesAdmin";

export function AdminScreen() {
  const { items, loading, unreachable } = useLive();
  const parkings = items.map((item) => item.config);

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:pl-24">
      <PageHeader title="Admin" />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:px-4 lg:pb-4">
        {unreachable ? <UnreachableState /> : loading || parkings.length === 0 ? <ListSkeleton /> : <ZonesAdmin parkings={parkings} />}
      </div>
    </div>
  );
}
