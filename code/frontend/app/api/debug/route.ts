import { MOCK_ENABLED, getDebug, mockDisabled, setDebug } from "@/lib/mock";
import type { DebugState } from "@/lib/types";

export const dynamic = "force-dynamic";

// Never blocked by networkCut: the panel must always be able to restore normal behaviour.
export async function GET() {
  if (!MOCK_ENABLED) return mockDisabled();
  return Response.json(getDebug(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!MOCK_ENABLED) return mockDisabled();
  const patch = (await req.json()) as Partial<DebugState>;
  return Response.json(setDebug(patch));
}
