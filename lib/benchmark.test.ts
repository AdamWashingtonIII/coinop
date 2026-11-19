import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getDb, schema } from "./db";
import { issueTaskNonce, setProfile, directory, sanitizeModel } from "./tasks";
import { benchmark } from "./benchmark";
import { agentRecord } from "./records";

async function sign(a: ReturnType<typeof privateKeyToAccount>) {
  const { nonce, message } = await issueTaskNonce(a.address, { op: "profile" });
  return { nonce, signature: await a.signMessage({ message }) };
}
let seq = 0;
async function score(wallet: string, gameSlug: string, value: number, verified = true) {
  const db = await getDb();
  await db.insert(schema.scores).values({ id: "bench-" + (++seq), gameSlug, wallet, value,
    verified, sessionId: "bench-sid-" + seq, rulesetHash: "test" });
}

const alpha = privateKeyToAccount(generatePrivateKey()); // model-x, two games
const beta = privateKeyToAccount(generatePrivateKey());  // model-x too (second wallet)
const gamma = privateKeyToAccount(generatePrivateKey()); // model-y
const untagged = privateKeyToAccount(generatePrivateKey());
const HOUSE = "0x2D3f3F16EF47a8345D65b277217B5B6Dcb2386ff"; // the test agent: a HOUSE_WALLETS entry

describe("model tag on profiles", () => {
  it("sanitizes: trims, collapses whitespace/control chars, caps at 40 chars", () => {
    expect(sanitizeModel("  claude-sonnet-4.5 ")).toBe("claude-sonnet-4.5");
    expect(sanitizeModel("gpt\n5\t pro")).toBe("gpt 5 pro");
    expect(sanitizeModel("x".repeat(60))).toHaveLength(40);
    expect(sanitizeModel("   ")).toBeNull();
    expect(sanitizeModel(undefined)).toBeNull();
    expect(sanitizeModel(42)).toBeNull();
  });
  it("setProfile stores the model through the signed update; directory and record expose it", async () => {
    const s = await sign(alpha);
    const p = await setProfile(alpha.address, s.nonce, s.signature,
      { name: "ALPHA", capabilities: ["snake"], blurb: "b", model: "model-x" });
    expect(p.model).toBe("model-x");
    const dir = await directory();
    expect(dir.find((d) => d.wallet === alpha.address.toLowerCase())?.model).toBe("model-x");
    expect((await agentRecord(alpha.address)).model).toBe("model-x");
  });
});

describe("benchmark aggregation", () => {
  it("groups verified scores by model tag: best, plays, distinct wallets, leaders", async () => {
    const sb = await sign(beta);
    await setProfile(beta.address, sb.nonce, sb.signature, { model: "model-x" });
    const sg = await sign(gamma);
    await setProfile(gamma.address, sg.nonce, sg.signature, { model: "model-y" });
    // snake: model-x best 120 over 3 plays / 2 wallets; model-y best 200 over 1 play
    await score(alpha.address, "snake", 100); await score(alpha.address, "snake", 120);
    await score(beta.address, "snake", 90);
    await score(gamma.address, "snake", 200);
    // stacker: model-x best 55
    await score(alpha.address, "stacker", 55);
    // noise that must NOT count: untagged wallet, unverified score
    await score(untagged.address, "snake", 9999);
    await score(gamma.address, "snake", 8888, false);

    const b = await benchmark();
    const snake = b.games.find((g) => g.gameSlug === "snake");
    expect(snake?.models).toEqual([
      { model: "model-y", best: 200, plays: 1, wallets: 1, house: false },
      { model: "model-x", best: 120, plays: 3, wallets: 2, house: false },
    ]);
    const stacker = b.games.find((g) => g.gameSlug === "stacker");
    expect(stacker?.models).toEqual([{ model: "model-x", best: 55, plays: 1, wallets: 1, house: false }]);
    expect(b.leaders.find((l) => l.gameSlug === "snake")?.model).toBe("model-y");
    expect(b.leaders.find((l) => l.gameSlug === "stacker")?.model).toBe("model-x");
    // games with no tagged scores are absent entirely
    expect(b.games.find((g) => g.gameSlug === "chess")).toBeUndefined();
  });

  it("labels a model house when every tagged wallet is a house wallet", async () => {
    const db = await getDb();
    await db.insert(schema.agentProfiles).values({ wallet: HOUSE.toLowerCase(), name: "HOUSE-ACE",
      capabilities: [], blurb: null, model: "house", updatedAt: new Date() });
    await score(HOUSE, "snake", 150); // checksummed wallet, as production stores them
    const b = await benchmark();
    const snake = b.games.find((g) => g.gameSlug === "snake");
    const house = snake?.models.find((m) => m.model === "house");
    expect(house).toEqual({ model: "house", best: 150, plays: 1, wallets: 1, house: true });
  });
});
