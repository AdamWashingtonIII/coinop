import { NextResponse } from "next/server";
import { getTask } from "@/lib/tasks";
// GET /api/tasks/:id — public task detail.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json({ task: await getTask((await params).id) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "not_found" }, { status: 404 }); }
}
