// Minimal COINOP API client for the ElizaOS plugin: the same x402 payment flow
// the MCP server (examples/mcp-server) uses, with the same hard safety rules —
// this client will ONLY sign a payment for exactly 250000 atomic USDC (0.25) to
// the arcade's stated payTo, for the chain's canonical USDC contract, on the
// configured chain. Any other 402 terms are refused before signing.
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const PRICE_ATOMIC = "250000"; // 0.25 USDC, 6 decimals — hardcoded, never floats
export const USDC_BY_CHAIN: Record<number, string> = {
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
};

export interface CoinopSession {
  token: string;
  sid: string;
  gameSlug: string;
  expiresAt: number;
}

export interface CoinopClientOptions {
  baseUrl: string; // e.g. https://coinop-one.vercel.app
  privateKey: `0x${string}`;
  chainId?: number; // 84532 (default) or 8453
}

interface PaymentRequirements {
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
}

export class CoinopClient {
  readonly baseUrl: string;
  readonly chainId: number;
  readonly account: PrivateKeyAccount;
  private session: CoinopSession | null = null;

  constructor(opts: CoinopClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.chainId = opts.chainId ?? 84532;
    if (!USDC_BY_CHAIN[this.chainId]) throw new Error(`unsupported COINOP_CHAIN_ID ${this.chainId}`);
    this.account = privateKeyToAccount(opts.privateKey);
  }

  get wallet(): string {
    return this.account.address;
  }

  get activeSession(): CoinopSession | null {
    return this.session;
  }

  private async api(path: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    const r = await fetch(this.baseUrl + path, init);
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: r.status, json };
  }

  private bearer(): Record<string, string> {
    if (!this.session) throw new Error("no active COINOP session — insert a coin first");
    return { authorization: "Bearer " + this.session.token };
  }

  /** Catalog of games, rules, actions, prices. Public, no payment. */
  async games(): Promise<unknown> {
    const { json } = await this.api("/api/games");
    return json;
  }

  // One x402 payment dance against a paid endpoint (solo coin or versus stake).
  private async payFlow(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const first = await this.api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (first.status !== 402) {
      throw new Error(`expected 402 from ${path}, got ${first.status} ${JSON.stringify(first.json)}`);
    }
    const accepts = (first.json as { accepts?: PaymentRequirements[] }).accepts;
    const reqs = accepts?.[0];
    if (!reqs) throw new Error("402 response carried no payment requirements");
    // Hard spend cap — refuse anything that is not exactly one quarter of canonical USDC.
    if (reqs.maxAmountRequired !== PRICE_ATOMIC) {
      throw new Error(`refusing: amount is not exactly ${PRICE_ATOMIC} atomic USDC`);
    }
    const usdc = USDC_BY_CHAIN[this.chainId];
    if ((reqs.asset ?? "").toLowerCase() !== usdc.toLowerCase()) {
      throw new Error(`refusing: asset is not the canonical USDC for chain ${this.chainId}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: this.account.address,
      to: reqs.payTo,
      value: PRICE_ATOMIC,
      validAfter: "0",
      validBefore: String(now + 3600),
      nonce: ("0x" + randomBytes(32).toString("hex")) as `0x${string}`,
    };
    const signature = await this.account.signTypedData({
      domain: { name: "USDC", version: "2", chainId: this.chainId, verifyingContract: usdc as `0x${string}` },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to as `0x${string}`,
        value: 250000n,
        validAfter: 0n,
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });
    const payload = { x402Version: 1, scheme: "exact", network: reqs.network, payload: { signature, authorization } };
    const paid = await this.api(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
      body: JSON.stringify(body),
    });
    if (paid.status !== 200) {
      throw new Error(`payment rejected: ${paid.status} ${JSON.stringify(paid.json)}`);
    }
    return paid.json;
  }

  /**
   * Pay 0.25 USDC and start a solo play session. `referralCode` only matters on
   * this wallet's first-ever coin: pass another agent's code and they earn
   * 25 QTR when you complete your first game.
   */
  async insertCoin(gameSlug: string, referralCode?: string): Promise<CoinopSession> {
    const paid = await this.payFlow("/api/coin", {
      gameSlug,
      ...(referralCode ? { referralCode } : {}),
    });
    this.session = {
      token: String(paid.sessionToken),
      sid: String(paid.sid),
      gameSlug,
      expiresAt: Number(paid.expiresAt),
    };
    return this.session;
  }

  /** Current server-authoritative state of the active session. */
  async state(): Promise<unknown> {
    const { json } = await this.api("/api/play/state", { headers: this.bearer() });
    return json;
  }

  /** Send one action (stacker: "drop" · snake: "up"/"down"/"left"/"right" · breaker: "left"/"right"). */
  async act(action: string, actionId?: string): Promise<unknown> {
    const { json } = await this.api("/api/play/action", {
      method: "POST",
      headers: { ...this.bearer(), "content-type": "application/json" },
      body: JSON.stringify({ action, ...(actionId ? { actionId } : {}) }),
    });
    return json;
  }

  /** Extend the session token by 90s (max 10 minutes total per coin). */
  async heartbeat(): Promise<void> {
    await this.api("/api/coin/heartbeat", { method: "POST", headers: this.bearer() });
  }
}
