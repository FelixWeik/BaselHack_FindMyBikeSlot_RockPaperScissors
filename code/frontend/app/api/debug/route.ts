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
  const patch: unknown = await req.json().catch(() => null);
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) return Response.json({ error: "expected a JSON object" }, { status: 400 });
  return Response.json(setDebug(patch as Partial<DebugState>));
}
