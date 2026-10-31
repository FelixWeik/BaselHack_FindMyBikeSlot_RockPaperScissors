"use client";

import { PageHeader } from "@/components/shell/PageHeader";
import { ListSkeleton } from "@/components/ui/primitives";
import { useAdmin } from "@/lib/adminStore";
import { AdminUnreachable } from "./AdminUnreachable";
import { ZonesAdmin } from "./ZonesAdmin";

export function AdminScreen() {
  const admin = useAdmin();

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:pl-24">
      <div className="px-4">
        <PageHeader title="Admin" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:px-4 lg:pb-4">
        {admin.status === "error" ? <AdminUnreachable /> : admin.status === "loading" ? <ListSkeleton /> : <ZonesAdmin admin={admin} />}
      </div>
    </div>
  );
}
