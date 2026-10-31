import { MOCK_ENABLED, debugGate, mockDisabled, resetMockParkings } from "@/lib/mock";

export const dynamic = "force-dynamic";

export async function DELETE() {
  if (!MOCK_ENABLED) return mockDisabled();
  const blocked = await debugGate();
  if (blocked) return blocked;
  resetMockParkings();
  return new Response(null, { status: 204 });
}
