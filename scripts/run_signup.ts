import { randomUUID } from "node:crypto";
import { decideSignupNotification } from "../src/verification_policy.js";

const email = process.env.DEMO_EMAIL_TO;
if (!email) throw new Error("DEMO_EMAIL_TO is required");

const result = await decideSignupNotification({
  signupId: randomUUID(),
  email,
  verificationUrl: "https://example.test/verify?token=demo-token",
  paymentEvent: { eventId: "evt_demo_001", kind: "card_attached", amountCents: 0 },
  risk: { score: 18, deviceTrusted: true },
});

console.log(JSON.stringify(result, null, 2));
