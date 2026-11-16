import { NextResponse } from "next/server";
import { precheckPayload, verifyPayment, paymentRequiredBody, paymentRequiredHeaders, type PaymentRequirements } from "./facilitator";
// The x402 gate shared by the versus endpoints (ADR 0009), mirroring
// /api/coin: no payment header -> 402 with requirements; a payload is verified
// with the facilitator BEFORE any state is created, and nothing settles here —
// callers settle asynchronously only after their guards pass, so a rejected
// request (409/400) never moves funds: the signed authorization goes unused.
// The 402 body/headers come from the facilitator module so every paid route
// speaks the selected provider's wire format (v1 legacy / v2 CDP + Bazaar).
export function paymentRequiredResponse(reqs: PaymentRequirements, error: string): NextResponse {
  const body = paymentRequiredBody(reqs, error);
  return NextResponse.json(body, { status: 402, headers: paymentRequiredHeaders(body) });
}
export type PaygateResult = { payer: string; payload: unknown } | { response: NextResponse };
export async function paygate(req: Request, reqs: PaymentRequirements): Promise<PaygateResult> {
  const header = req.headers.get("payment-signature") ?? req.headers.get("x-payment");
  if (!header) {
    return { response: paymentRequiredResponse(reqs, "payment_required") };
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(header, "base64").toString("utf8")); }
  catch { return { response: paymentRequiredResponse(reqs, "bad_payment_header") }; }
  const pre = precheckPayload(payload, reqs);
  if (pre) return { response: paymentRequiredResponse(reqs, pre) };
  let verdict;
  try { verdict = await verifyPayment(payload, reqs); }
  catch { return { response: NextResponse.json({ error: "facilitator_down_try_again" }, { status: 503 }) }; }
  if (!verdict.isValid) {
    return { response: paymentRequiredResponse(reqs, verdict.invalidReason ?? "invalid_payment") };
  }
  const payer = verdict.payer ?? (payload as { payload?: { authorization?: { from?: string } } }).payload?.authorization?.from ?? "unknown";
  return { payer, payload };
}
