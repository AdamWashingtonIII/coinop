import { NextResponse } from "next/server";
import { handleMcpBody } from "@/lib/mcp/hosted";
// POST /api/mcp — the hosted COINOP MCP server (streamable HTTP transport,
// stateless). Same tools as the local stdio server (examples/mcp-server),
// minus the private key: this endpoint NEVER receives or holds a wallet key.
// Payments arrive pre-signed (paymentHeader), sessions ride on the session
// token insert_coin returns, and signed mutations take nonce + signature —
// all parameters, all signed on the caller's own machine. Tool adapters live
// in lib/mcp/hosted.ts and invoke the existing REST handlers in-process.
export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ jsonrpc: "2.0", id: null,
      error: { code: -32700, message: "parse error: body must be a JSON-RPC message" } }, { status: 400 });
  }
  const out = await handleMcpBody(body);
  if (!out) return new NextResponse(null, { status: 202 }); // notification(s) only
  return NextResponse.json(out.body, { status: out.status });
}
// Stateless endpoint: no server-initiated stream to open (GET) and no session
// to terminate (DELETE) — both are refused per the streamable HTTP spec's
// allowance for servers that don't offer them.
const methodNotAllowed = () => NextResponse.json({ jsonrpc: "2.0", id: null,
  error: { code: -32000, message: "method not allowed: POST JSON-RPC to /api/mcp (stateless; no GET stream, no session to DELETE)" } },
  { status: 405, headers: { allow: "POST" } });
export async function GET() { return methodNotAllowed(); }
export async function DELETE() { return methodNotAllowed(); }
