import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <>
      <PageHeader title="Wrong turn" />
      <p className="mb-5 text-muted">This page doesn&apos;t exist.</p>
      <Link href="/" className="tap inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-primary-fg">
        Back to the parkings
      </Link>
    </>
  );
}
