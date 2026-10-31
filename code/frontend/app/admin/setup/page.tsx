import { Suspense } from "react";
import { SetupWizard } from "@/components/admin/setup/SetupWizard";
import { ListSkeleton } from "@/components/ui/primitives";

export const metadata = { title: "Create a zone" };

export default function AdminSetupPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <SetupWizard />
    </Suspense>
  );
}
