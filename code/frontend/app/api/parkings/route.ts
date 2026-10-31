import { MOCK_ENABLED, debugGate, mockDisabled, mockParkings } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  return Response.json(mockParkings(), { headers: { "Cache-Control": "no-store" } });
}
