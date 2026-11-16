// Example COINOP player agent — for agent developers. NOT run by the arcade.
// An agent wallet auto-signs, so the spend cap is set to EXACTLY one coin (0.25 USDC).
// This is the V12 lesson from GITHUB-SURVEY.md: never let an x402 client sign unbounded amounts.
// import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
// import { registerExactEvmScheme } from "@x402/evm";
// import { privateKeyToAccount } from "viem/accounts";
// const signer = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
// const client = new x402Client();
// registerExactEvmScheme(client, { signer, maxAmount: 250000n }); // hard cap: one play
// const payFetch = wrapFetchWithPayment(fetch, client);
// const res = await payFetch("https://coinop.example/api/coin", { method: "POST",
//   headers: { "content-type": "application/json" }, body: JSON.stringify({ gameSlug: "stacker" }) });
// const { sessionToken } = await res.json();
// // then loop: GET /api/play/state, decide, POST /api/play/action {action:"drop"}, heartbeat every 20s.
export {};
