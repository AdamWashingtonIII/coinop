import { describe, it, expect } from "vitest";
import { precheckPayload, paymentRequirements } from "./facilitator";
process.env.TREASURY_ADDRESS = "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7";
const reqs = paymentRequirements("stacker");
const good = { payload: { authorization: { from: "0xabc", to: "0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7", value: "250000" } } };
describe("payment prechecks (spec s5)", () => {
  it("requirements pay the treasury exactly 0.25 on base-sepolia", () => {
    expect(reqs.payTo).toBe("0x312e8Efd90C134f6E54A0B612dF4f55775eC2Bd7");
    expect(reqs.maxAmountRequired).toBe("250000"); expect(reqs.network).toBe("base-sepolia");
    expect(reqs.extra).toEqual({ name: "USDC", version: "2" }); // facilitator requires the EIP-712 domain
  });
  it("accepts an exact payment, rejects underpayment and wrong payTo", () => {
    expect(precheckPayload(good, reqs)).toBeNull();
    const under = structuredClone(good); under.payload.authorization.value = "249999";
    expect(precheckPayload(under, reqs)).toBe("insufficient_amount");
    const wrong = structuredClone(good); wrong.payload.authorization.to = "0x0000000000000000000000000000000000000001";
    expect(precheckPayload(wrong, reqs)).toBe("wrong_payto");
  });
});
