import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
process.env.SESSION_HMAC_SECRET = ["hosted", "mcp", "test", "secret"].join("-");
process.env.TREASURY_ADDRESS = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
process.env.MATCH_ESCROW_ADDRESS = "0x27501C6B06cA445579488b8d4E44998222171d74";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HOSTED_TOOLS, handleMcpBody } from "./hosted";
import { POST as mcpPOST, GET as mcpGET } from "@/app/api/mcp/route";

// Drive the JSON-RPC layer exactly as an MCP client over HTTP would.
async function rpc(method: string, params?: unknown, id = 1) {
  const out = await handleMcpBody({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
  expect(out).not.toBeNull();
  return out!.body as {
    result: {
      serverInfo: { name: string; version: string };
      capabilities: { tools: Record<string, unknown> };
      instructions: string;
      tools: { name: string; inputSchema: Record<string, unknown> }[];
      content: { type: string; text: string }[];
    };
    error?: { code: number; message: string };
  };
}
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  expect(r.error).toBeUndefined();
  return r.result as { content: { type: string; text: string }[]; isError?: boolean };
}
const toolJson = async (name: string, args: Record<string, unknown> = {}) =>
  JSON.parse((await callTool(name, args)).content[0].text);

describe("hosted MCP endpoint (/api/mcp)", () => {
  it("initialize answers with server info and the no-key instructions", async () => {
    const r = await rpc("initialize", { protocolVersion: "2024-11-05" });
    expect(r.result.serverInfo).toEqual({ name: "coinop", version: "1.0.0" });
    expect(r.result.capabilities).toEqual({ tools: {} });
    expect(r.result.instructions).toContain("NEVER takes a private key");
  });

  it("tools/list exposes the full hosted tool set (local 25, adapted + nonce helpers + benchmark/stats + task_cancel)", async () => {
    const r = await rpc("tools/list");
    const names = r.result.tools.map((t: { name: string }) => t.name);
    expect(names).toHaveLength(HOSTED_TOOLS.length);
    expect(names).toHaveLength(31);
    for (const n of ["coinop_games", "coinop_insert_coin", "coinop_state", "coinop_act", "coinop_heartbeat",
      "coinop_claim", "coinop_create_match", "coinop_join_match", "coinop_set_profile", "coinop_task_post",
      "coinop_claim_nonce", "coinop_qtr_nonce", "coinop_tasks_nonce", "coinop_benchmark", "coinop_stats",
      "coinop_task_cancel"]) expect(names).toContain(n);
    // No tool may ask for a private key — that is the whole design rule.
    for (const t of r.result.tools) {
      expect(JSON.stringify(t.inputSchema)).not.toMatch(/private_?key/i);
    }
  });

  it("coinop_games returns the live catalog (read tool over the real handler)", async () => {
    const j = await toolJson("coinop_games");
    expect(j.arcade).toBe("COINOP");
    expect(j.games.map((g: { slug: string }) => g.slug)).toContain("snake");
  });

  it("coinop_rewards reads a fresh wallet as zero", async () => {
    const j = await toolJson("coinop_rewards", { wallet: "0x00000000000000000000000000000000000000aa" });
    expect(j.tokensAccrued).toBe(0);
    expect(j.tokensClaimable).toBe(0);
  });

  it("coinop_benchmark returns the model leaderboard shape", async () => {
    const j = await toolJson("coinop_benchmark");
    expect(Array.isArray(j.games)).toBe(true);
    expect(Array.isArray(j.leaders)).toBe(true);
  });

  it("coinop_insert_coin without paymentHeader returns the 402 terms and creates NO session (nothing is signed server-side)", async () => {
    const res = await callTool("coinop_insert_coin", { gameSlug: "snake" });
    expect(res.isError).toBeFalsy();
    const j = JSON.parse(res.content[0].text);
    expect(j.accepts?.[0]?.maxAmountRequired).toBe("250000");
    expect(j.accepts?.[0]?.payTo).toBe(process.env.TREASURY_ADDRESS);
    expect(j.sessionToken).toBeUndefined();
    expect(j.note).toContain("never leaves your machine");
  });

  it("signed mutations work with nonce + local signature only (profile + model tag)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await toolJson("coinop_tasks_nonce", { wallet: account.address, op: "profile" });
    expect(nonce.message).toBe("COINOP task:profile:" + account.address.toLowerCase() + ":" + nonce.nonce);
    const signature = await account.signMessage({ message: nonce.message });
    const profile = await toolJson("coinop_set_profile",
      { wallet: account.address, nonce: nonce.nonce, signature, name: "Hosted Test", model: "hosted-test-model" });
    expect(profile.profile.model).toBe("hosted-test-model");
    const dir = await toolJson("coinop_agents_directory");
    const me = dir.agents.find((a: { wallet: string }) => a.wallet.toLowerCase() === account.address.toLowerCase());
    expect(me?.model).toBe("hosted-test-model");
  });

  it("a bad signature is refused by the underlying REST verification", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = await toolJson("coinop_tasks_nonce", { wallet: account.address, op: "profile" });
    const res = await callTool("coinop_set_profile",
      { wallet: account.address, nonce: nonce.nonce, signature: "0x" + "00".repeat(65), name: "Nope" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("COINOP 400");
  });

  it("unknown tools and methods get JSON-RPC errors; notifications get no answer", async () => {
    const bad = await rpc("tools/call", { name: "coinop_nope", arguments: {} });
    expect(bad.error?.code).toBe(-32602);
    const badMethod = await rpc("resources/list");
    expect(badMethod.error?.code).toBe(-32601);
    const note = await handleMcpBody({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note).toBeNull();
  });

  it("the route handler speaks HTTP: POST initialize -> 200, GET -> 405", async () => {
    const res = await mcpPOST(new Request("http://localhost/api/mcp", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} }) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.id).toBe(7);
    expect(j.result.serverInfo.name).toBe("coinop");
    expect((await mcpGET()).status).toBe(405);
  });
});
