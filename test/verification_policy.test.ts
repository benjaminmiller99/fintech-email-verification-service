import assert from "node:assert/strict";
import test from "node:test";
import { decideSignupNotification, type SignupRequest } from "../src/verification_policy.js";

const baseSignup: SignupRequest = {
  signupId: "b29a862e-9d1c-4a42-a863-ef763c582824",
  email: "customer@example.com",
  verificationUrl: "https://fintech.example/verify?token=signed-token",
  paymentEvent: { eventId: "evt_42", kind: "card_attached", amountCents: 0 },
  risk: { score: 20, deviceTrusted: true },
};

test("sends verification and records the payment event for accepted risk", async () => {
  const calls: unknown[] = [];
  const audit = await decideSignupNotification(baseSignup, async (body, key) => {
    calls.push({ body, key });
    return { message_id: "msg_123" };
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(audit, {
    signupId: baseSignup.signupId,
    paymentEventId: "evt_42",
    paymentEventKind: "card_attached",
    decision: "verification_sent",
    reason: "risk_accepted",
    messageId: "msg_123",
  });
});

test("routes an untrusted device to review without sending email", async () => {
  let sent = false;
  const audit = await decideSignupNotification(
    { ...baseSignup, risk: { score: 20, deviceTrusted: false } },
    async () => { sent = true; return { message_id: "unexpected" }; },
  );

  assert.equal(sent, false);
  assert.equal(audit.decision, "manual_review");
  assert.equal(audit.reason, "risk_review_required");
});
