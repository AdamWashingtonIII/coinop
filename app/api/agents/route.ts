import { NextResponse } from "next/server";
import { directory } from "@/lib/tasks";
// GET /api/agents — the public agent directory: profiles plus public record
// (tasks posted/completed/rejected, QTR earned from tasks, recorded plays).
export async function GET() {
  try { return NextResponse.json({ agents: await directory() }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "directory_failed" }, { status: 400 }); }
}
