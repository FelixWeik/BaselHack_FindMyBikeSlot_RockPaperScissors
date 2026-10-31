import { MOCK_ENABLED, debugGate, getDebug, mockDisabled, mockHeatmap } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  const { id } = await params;
  const heatmap = mockHeatmap(id, Date.now(), getDebug());
  if (!heatmap) return Response.json({ error: "unknown parking" }, { status: 404 });
  return Response.json(heatmap, { headers: { "Cache-Control": "no-store" } });
}
