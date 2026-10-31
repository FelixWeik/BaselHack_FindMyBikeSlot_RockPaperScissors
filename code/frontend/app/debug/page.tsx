import { PageHeader } from "@/components/shell/PageHeader";
import { DebugPanel } from "./DebugPanel";

export const metadata = { title: "Demo controls" };

export default function DebugPage() {
  return (
    <>
      <PageHeader eyebrow="Mock mode only" title="Demo controls" live />
      <DebugPanel />
    </>
  );
}
