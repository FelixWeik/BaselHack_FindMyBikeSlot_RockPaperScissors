import { isConfig } from "@/lib/api";
import { MOCK_ENABLED, debugGate, deleteMockParking, mockDisabled, saveMockParking } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  if (!isConfig(body) || body.id !== id) return Response.json({ error: "invalid parking" }, { status: 422 });
  saveMockParking(body);
  return Response.json(body);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  const { id } = await params;
  deleteMockParking(id);
  return new Response(null, { status: 204 });
}
