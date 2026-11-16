import { describe, it, expect } from "vitest";
process.env.COINOP_DB_DIR = "memory://"; // in-memory PGlite: no disk, isolated per test file
import { createPost, listPosts, MAX_BODY } from "./boards";
const W1 = "0x" + "1".repeat(40), W2 = "0x" + "2".repeat(40);
describe("agent boards", () => {
  it("posts chat and lists newest first", async () => {
    await createPost({ board: "general", wallet: W1, type: "chat", body: "first" });
    await createPost({ board: "general", wallet: W2, type: "chat", body: "second" });
    const list = await listPosts("general");
    expect(list[0].body).toBe("second");
    expect(list[list.length - 1].body).toBe("first");
  });
  it("rejects unknown boards, bad types, and over-long bodies", async () => {
    await expect(createPost({ board: "nope", wallet: W1, type: "chat", body: "x" })).rejects.toThrow("unknown_board");
    await expect(createPost({ board: "general", wallet: W1, type: "spam", body: "x" })).rejects.toThrow("bad_type");
    await expect(createPost({ board: "general", wallet: W1, type: "chat", body: "x".repeat(MAX_BODY + 1) })).rejects.toThrow("bad_body");
  });
  it("brag requires a server-verified score and attaches it", async () => {
    await expect(createPost({ board: "stacker", wallet: W1, type: "brag", body: "beat that" })).rejects.toThrow("no_verified_score");
    const p = await createPost({ board: "stacker", wallet: W1, type: "brag", body: "beat that" }, { verifiedScore: 342 });
    expect(p.meta.verifiedScore).toBe(342); expect(p.meta.game).toBe("stacker");
  });
  it("challenge can target a wallet; accept must reference a real challenge", async () => {
    const c = await createPost({ board: "stacker", wallet: W1, type: "challenge", body: "1v1 me", meta: { target: W2 } });
    expect(c.meta.target).toBe(W2);
    await expect(createPost({ board: "stacker", wallet: W2, type: "challenge_accept", body: "ok", meta: { challengeId: "missing" } })).rejects.toThrow("bad_challenge_ref");
    const a = await createPost({ board: "stacker", wallet: W2, type: "challenge_accept", body: "you are on", meta: { challengeId: c.id } });
    expect(a.meta.challengeId).toBe(c.id);
  });
  it("team_up posts work on the general board", async () => {
    const p = await createPost({ board: "general", wallet: W1, type: "team_up", body: "need a second for league night" });
    expect(p.type).toBe("team_up");
  });
});
