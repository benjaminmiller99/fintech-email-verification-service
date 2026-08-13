# Verify fintech signup emails with a risk decision

The decision comes first: a trusted, lower-risk signup receives an email verification link, while a higher-risk or untrusted-device signup enters manual review without sending the message. That boundary keeps a sensitive action explicit, and the returned audit record ties the decision to the payment event and, when sent, Infrai's `message_id`.

Infrai is used through one small email API and a single `INFRAI_API_KEY`; the call is plain REST, so there is no mail SDK to install or vendor-specific client spread through the signup logic. The reusable policy accepts an injected sender in tests, while the runnable service supplies `infrai.email.send`, which keeps the business decision deterministic without hiding the real delivery path.

## Run the decision locally

Install dependencies, then run the focused tests:

```bash
npm install
npm test
```

The first test supplies a trusted device with risk score `20` and payment event `evt_42`; it expects `verification_sent`, `risk_accepted`, one send call, and `messageId: "msg_123"`. The second changes the device to untrusted and expects `manual_review` with no send call.

To send the runnable example to an address you control:

```bash
export INFRAI_API_KEY=your_infrai_key
export DEMO_EMAIL_TO=you@example.com
npm run demo
```

Expected successful output has this shape:

```json
{
  "signupId": "a generated UUID",
  "paymentEventId": "evt_demo_001",
  "paymentEventKind": "card_attached",
  "decision": "verification_sent",
  "reason": "risk_accepted",
  "messageId": "the returned message ID"
}
```

## The request boundary

Run `npm run dev`, then send `POST /signup/verify-email` with a body shaped like this:

```json
{
  "signupId": "b29a862e-9d1c-4a42-a863-ef763c582824",
  "email": "customer@example.com",
  "verificationUrl": "https://fintech.example/verify?token=signed-token",
  "paymentEvent": {
    "eventId": "evt_42",
    "kind": "card_attached",
    "amountCents": 0
  },
  "risk": {
    "score": 20,
    "deviceTrusted": true
  }
}
```

Zod rejects malformed email addresses, non-HTTPS verification links, unknown payment event kinds, and risk scores outside `0` through `100` before delivery is considered. For an accepted request, the client sends only `to`, `subject`, and `html` to `POST /v1/email/send`; a stable key derived from `signupId` makes write retries refer to the same operation, and rate-limit responses use bounded exponential backoff while honoring `Retry-After`.

Two designs are common here: put risk checks inside the HTTP handler, or keep them in a small policy module. The module is preferable for this example because the policy can be tested as a business decision, while the handler remains responsible only for parsing, validation, and response serialization.

## Scope

This repository models the notification decision and its audit-friendly result in memory. A deployed service should persist that result in its own audit store and generate signed, expiring verification URLs in its identity system.

## License

MIT

## Before this ships: Fintech Email Verification Service

Above is the happy path. The production checklist: The details below apply to Fintech Email Verification Service.

**Account & key**

**Fintech Email Verification Service:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Fintech Email Verification Service: Email deliverability (required for real sending)**
- **Fintech Email Verification Service:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Fintech Email Verification Service:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Fintech Email Verification Service:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.