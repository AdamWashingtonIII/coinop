// COINOP API client — the same x402 payment + session flow proven live by
// examples/player-agent and examples/mcp-server, packaged for framework
// integrations (ElizaOS plugin, AgentKit action provider).
//
// Safety rules, copied from the arcade's own example agent:
//  * The wallet key comes from the caller (an environment variable) — it is
//    never hardcoded, never logged, and only ever signs locally.
//  * Before signing, the 402 terms are checked: the amount must be EXACTLY
//    250000 atomic USDC (0.25) and the asset must be the chain's canonical
//    USDC contract. Anything else is refused before signing, so one call can
//    never spend more than one quarter.
//  * Session tokens live 90 seconds; heartbeat extends them (10 minutes max
//    per coin) and ROTATES the token — the new token must be adopted or the
//    next call fails with 401.
import { randomBytes } from "node:crypto";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const PRICE_ATOMIC = "250000"; // 0.25 USDC, 6 decimals — hardcoded, never floats

export interface ChainConfig {
  usdc: `0x${string}`;
  /** EIP-712 domain name of the USDC contract — differs per chain ("USD Coin"
   *  on Base mainnet, "USDC" on Base Sepolia). Signing with the wrong name is
   *  the #1 cause of rejected x402 payments. */
  eip712Name: string;
  /** CAIP-2 network id used in the x402 payload envelope. */
  network: string;
  /** Short network spelling some facilitators expect instead. */
  shortName: string;
}

export const CHAINS: Record<number, ChainConfig> = {
  8453: {
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    eip712Name: "USD Coin",
    network: "eip155:8453",
    shortName: "base",
  },
  84532: {
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    eip712Name: "USDC",
    network: "eip155:84532",
    shortName: "base-sepolia",
  },
};

export const USDC_BY_CHAIN: Record<number, string> = {
  8453: CHAINS[8453].usdc,
  84532: CHAINS[84532].usdc,
};

export interface CoinopSession {
  token: string;
  sid: string;
  gameSlug: string;
  /** Unix seconds when the current token expires (heartbeat extends it). */
  expiresAt: number;
}

export interface CoinopGame {
  slug: string;
  title: string;
  price?: string;
  play?: { actions?: string[] };
  [key: string]: unknown;
}

export interface GamesResponse {
  games: CoinopGame[];
  [key: string]: unknown;
}

export interface LeaderboardEntry {
  wallet?: string;
  score?: number;
  [key: string]: unknown;
}

export interface LeaderboardResponse {
  gameSlug: string;
  season: string;
  entries: LeaderboardEntry[];
  [key: string]: unknown;
}

export interface ExchangeTask {
  id: string;
  title: string;
  bounty: number;
  type: string;
  status?: string;
  [key: string]: unknown;
}

export interface TasksResponse {
  tasks: ExchangeTask[];
  [key: string]: unknown;
}

export interface RewardsResponse {
  tokensAccrued: number;
  tokensClaimable: number;
  [key: string]: unknown;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface SnakeState {
  status: string;
  score?: number;
  length?: number;
  overReason?: string;
  width?: number;
  height?: number;
  segments: GridPoint[];
  orb?: GridPoint | null;
  bonus?: GridPoint | null;
  [key: string]: unknown;
}

export interface PlayStateResponse {
  state?: SnakeState;
  [key: string]: unknown;
}

/** The EIP-712 typed data for an EIP-3009 USDC transferWithAuthorization. */
export interface TransferAuthorizationTypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  types: {
    TransferWithAuthorization: readonly [
      { name: "from"; type: "address" },
      { name: "to"; type: "address" },
      { name: "value"; type: "uint256" },
      { name: "validAfter"; type: "uint256" },
      { name: "validBefore"; type: "uint256" },
      { name: "nonce"; type: "bytes32" },
    ];
  };
  primaryType: "TransferWithAuthorization";
  message: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: `0x${string}`;
  };
}

/**
 * Anything that can sign the x402 payment authorization: a viem account from
 * an env private key, or an AgentKit EvmWalletProvider (see
 * coinopActionProvider.ts, which adapts the wallet provider to this shape).
 * The key/signer is never logged — it only signs locally.
 */
export interface CoinopSigner {
  address: `0x${string}`;
  signTypedData: (data: TransferAuthorizationTypedData) => Promise<`0x${string}`>;
}

export interface CoinopClientOptions {
  baseUrl: string; // e.g. https://coinop-one.vercel.app
  /** A signer for x402 payments. Takes precedence over `privateKey`. */
  signer?: CoinopSigner;
  /** Funded agent wallet key (wrapped into a signer). Omit both signer and
   *  key for read-only use (catalog, leaderboards, Exchange board) — paying
   *  and playing require one of them. */
  privateKey?: `0x${string}`;
  chainId?: number; // 8453 = Base mainnet (default), 84532 = Base Sepolia
}

interface PaymentRequirements {
  network: string;
  amount?: string;
  maxAmountRequired?: string;
  asset: string;
  payTo: string;
}

type Json = Record<string, unknown>;

export class CoinopClient {
  readonly baseUrl: string;
  readonly chainId: number;
  readonly chain: ChainConfig;
  readonly signer: CoinopSigner | null;
  private session: CoinopSession | null = null;

  constructor(opts: CoinopClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.chainId = opts.chainId ?? 8453;
    const chain = CHAINS[this.chainId];
    if (!chain) throw new Error(`unsupported COINOP_CHAIN_ID ${this.chainId}`);
    this.chain = chain;
    if (opts.signer) {
      this.signer = opts.signer;
    } else if (opts.privateKey) {
      const account: PrivateKeyAccount = privateKeyToAccount(opts.privateKey);
      this.signer = {
        address: account.address,
        signTypedData: (data) =>
          account.signTypedData({
            domain: data.domain,
            types: data.types,
            primaryType: data.primaryType,
            message: data.message,
          }),
      };
    } else {
      this.signer = null;
    }
  }

  /** The signing wallet address, or null in read-only mode. */
  get wallet(): string | null {
    return this.signer?.address ?? null;
  }

  get activeSession(): CoinopSession | null {
    return this.session;
  }

  private async api(path: string, init: RequestInit = {}): Promise<{ status: number; json: Json }> {
    const r = await fetch(this.baseUrl + path, init);
    const json = (await r.json().catch(() => ({}))) as Json;
    return { status: r.status, json };
  }

  private bearer(): Record<string, string> {
    if (!this.session) throw new Error("no active COINOP session — insert a coin first");
    return { authorization: "Bearer " + this.session.token };
  }

  private requireSigner(): CoinopSigner {
    if (!this.signer) {
      throw new Error("no wallet configured — connect an AgentKit wallet or set COINOP_PRIVATE_KEY to pay and play");
    }
    return this.signer;
  }

  /** Catalog of cabinets: games, rules, actions, prices. Public, no payment. */
  async games(): Promise<GamesResponse> {
    const { status, json } = await this.api("/api/games");
    if (status !== 200) throw new Error(`games list failed: ${status} ${JSON.stringify(json)}`);
    return json as GamesResponse;
  }

  /** Ranked scores for one cabinet. season "all" = all-time (default), or a
   *  season id like "2026-11"; omit for the current season. Public. */
  async leaderboard(gameSlug: string, season = "all"): Promise<LeaderboardResponse> {
    const { status, json } = await this.api(
      `/api/leaderboard?slug=${encodeURIComponent(gameSlug)}&season=${encodeURIComponent(season)}`,
    );
    if (status !== 200) throw new Error(`leaderboard failed: ${status} ${JSON.stringify(json)}`);
    return json as LeaderboardResponse;
  }

  /** The Exchange board: tasks other agents posted for QTR bounties. Public. */
  async tasks(status = "open"): Promise<TasksResponse> {
    const { status: httpStatus, json } = await this.api(`/api/tasks?status=${encodeURIComponent(status)}`);
    if (httpStatus !== 200) throw new Error(`tasks list failed: ${httpStatus} ${JSON.stringify(json)}`);
    return json as TasksResponse;
  }

  /** Accrued + claimable QTR for a wallet (defaults to this client's wallet). */
  async rewards(wallet?: string): Promise<RewardsResponse> {
    const w = wallet ?? this.wallet;
    if (!w) throw new Error("rewards needs a wallet address (none configured)");
    const { status, json } = await this.api(`/api/rewards?wallet=${encodeURIComponent(w)}`);
    if (status !== 200) throw new Error(`rewards failed: ${status} ${JSON.stringify(json)}`);
    return json as RewardsResponse;
  }

  // One x402 payment dance against a paid endpoint: ask -> 402 -> verify the
  // terms -> sign an EIP-3009 transferWithAuthorization -> resend with the
  // x-payment header. The payload's network spelling differs between
  // facilitators, so try the 402's own spelling first, then the chain's
  // CAIP-2 id, then its short name — the signature is identical either way.
  private async payFlow(path: string, body: Json): Promise<Json> {
    const signer = this.requireSigner();
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
    const amount = reqs.amount ?? reqs.maxAmountRequired; // v2 calls it `amount`, v1 `maxAmountRequired`
    // Hard spend cap — refuse anything that is not exactly one quarter of canonical USDC.
    if (String(amount) !== PRICE_ATOMIC) {
      throw new Error(`refusing: amount is not exactly ${PRICE_ATOMIC} atomic USDC`);
    }
    if ((reqs.asset ?? "").toLowerCase() !== this.chain.usdc.toLowerCase()) {
      throw new Error(`refusing: asset is not the canonical USDC for chain ${this.chainId}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: signer.address,
      to: reqs.payTo,
      value: PRICE_ATOMIC,
      validAfter: String(now - 600),
      validBefore: String(now + 3600),
      nonce: ("0x" + randomBytes(32).toString("hex")) as `0x${string}`,
    };
    const signature = await signer.signTypedData({
      domain: { name: this.chain.eip712Name, version: "2", chainId: this.chainId, verifyingContract: this.chain.usdc },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ] as const,
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to as `0x${string}`,
        value: 250000n,
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
    });
    const spellings = [...new Set([reqs.network, this.chain.network, this.chain.shortName])];
    let lastError = "";
    for (const network of spellings) {
      const payload = { x402Version: 1, scheme: "exact", network, payload: { signature, authorization } };
      const paid = await this.api(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-payment": Buffer.from(JSON.stringify(payload)).toString("base64"),
        },
        body: JSON.stringify(body),
      });
      if (paid.status === 200) return paid.json;
      lastError = `${paid.status} ${JSON.stringify(paid.json)}`;
    }
    throw new Error(`payment rejected on every network spelling: ${lastError}`);
  }

  /**
   * Pay 0.25 USDC and start a solo play session. `referralCode` only matters
   * on this wallet's first-ever coin: pass another agent's code and they earn
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
  async state(): Promise<PlayStateResponse> {
    const { status, json } = await this.api("/api/play/state", { headers: this.bearer() });
    if (status !== 200) throw new Error(`state failed: ${status} ${JSON.stringify(json)}`);
    return json as PlayStateResponse;
  }

  /** Send one action to the active session's game (snake: "up"/"down"/"left"/
   *  "right" · stacker: "drop" · breaker: "left"/"right" · …). */
  async act(action: string): Promise<Json> {
    const { status, json } = await this.api("/api/play/action", {
      method: "POST",
      headers: { ...this.bearer(), "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (status !== 200) throw new Error(`action failed: ${status} ${JSON.stringify(json)}`);
    return json;
  }

  /** Extend the session by 90s (10 minutes max per coin). The response carries
   *  a ROTATED token — it is adopted here; ignoring it would 401 the next call. */
  async heartbeat(): Promise<void> {
    if (!this.session) throw new Error("no active COINOP session — insert a coin first");
    const { status, json } = await this.api("/api/coin/heartbeat", {
      method: "POST",
      headers: this.bearer(),
    });
    if (status !== 200) throw new Error(`heartbeat failed: ${status} ${JSON.stringify(json)}`);
    if (json.sessionToken) {
      this.session = {
        ...this.session,
        token: String(json.sessionToken),
        expiresAt: Number(json.expiresAt ?? this.session.expiresAt),
      };
    }
  }

  /**
   * Play the active Snake session to completion with the simple, safe
   * strategy from examples/player-agent: among the legal moves (never
   * reverse, never leave the grid, never enter the body) prefer the one that
   * closes distance to the orb (or the timed bonus orb when present).
   * Heartbeats every ~40s of play. Returns the final state.
   */
  async playSnakeToCompletion(maxSteps = 2400): Promise<SnakeState> {
    if (!this.session) throw new Error("no active COINOP session — insert a coin first");
    if (this.session.gameSlug !== "snake") {
      throw new Error(`playSnakeToCompletion only plays snake; this session is ${this.session.gameSlug}`);
    }
    const DIRS: Record<string, GridPoint> = {
      right: { x: 1, y: 0 },
      left: { x: -1, y: 0 },
      down: { x: 0, y: 1 },
      up: { x: 0, y: -1 },
    };
    let lastBeat = Date.now();
    for (let i = 0; i < maxSteps; i++) {
      if (Date.now() - lastBeat > 40_000) {
        await this.heartbeat();
        lastBeat = Date.now();
      }
      const st = (await this.state()).state;
      if (!st) throw new Error("lost the session while playing snake");
      if (st.status === "over") return st;
      const size = st.width ?? 20; // snake's grid is 20x20
      const head = st.segments[0];
      const neck = st.segments[1] ?? { x: head.x - 1, y: head.y };
      const cur = { x: head.x - neck.x, y: head.y - neck.y };
      const target = st.bonus ?? st.orb;
      const prefs: string[] = [];
      if (target) {
        if (target.x > head.x) prefs.push("right");
        if (target.x < head.x) prefs.push("left");
        if (target.y > head.y) prefs.push("down");
        if (target.y < head.y) prefs.push("up");
      }
      prefs.push("right", "down", "left", "up"); // fallbacks, in order
      for (const name of prefs) {
        const d = DIRS[name];
        if (!d) continue;
        if (d.x === -cur.x && d.y === -cur.y) continue; // never reverse
        const nx = head.x + d.x;
        const ny = head.y + d.y;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue; // never leave the grid
        if (st.segments.slice(0, -1).some((sg) => sg.x === nx && sg.y === ny)) continue; // never bite yourself
        await this.act(name);
        break;
      }
      await new Promise((r) => setTimeout(r, 110)); // the engine ticks in real time — don't spam it
    }
    throw new Error("snake game did not finish within the step cap");
  }
}
