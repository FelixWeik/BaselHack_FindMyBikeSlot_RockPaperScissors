import { readFile } from "node:fs/promises";
import path from "node:path";
import { MOCK_ENABLED, debugGate, mockDisabled, mockSnapshot } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  const { id } = await params;
  const snapshot = mockSnapshot(id);
  if (!snapshot) return Response.json({ detail: "No frame arrived from this camera" }, { status: 504 });
  const photo = await readFile(path.join(process.cwd(), "public", snapshot));
  return new Response(photo, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
