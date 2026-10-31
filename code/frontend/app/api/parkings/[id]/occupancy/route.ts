import { MOCK_ENABLED, debugGate, getDebug, mockDisabled, mockOccupancy } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  const { id } = await params;
  const occupancy = mockOccupancy(id, Date.now(), getDebug());
  if (!occupancy) return Response.json({ error: "unknown parking" }, { status: 404 });
  return Response.json(occupancy, { headers: { "Cache-Control": "no-store" } });
}
