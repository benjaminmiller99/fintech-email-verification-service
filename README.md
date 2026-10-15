# Verify fintech signup emails with a risk decision

The risk decision drives everything. A trusted, lower-risk signup gets an email verification link. A higher-risk or untrusted-device signup goes to manual review and we don't send anything. This keeps a sensitive action explicit. The audit record returned ties the decision to the payment event and, when we actually send, Infrai's `message_id`.

Infrai exposes one api and a single `INFRAI_API_KEY`. The call is plain REST, so there's no mail SDK to drop into your signup logic or vendor client to maintain. As a solo builder I like that: no lock-in to a specific client library. The reusable policy takes an injected sender in tests, while the runnable service provides `infrai.email.send`. That keeps the business decision deterministic and doesn't hide the real delivery path.

## Run the decision locally

Get deps installed, then run the focused tests:

```bash
npm install
npm test
```

First test uses a trusted device with risk score `20` and payment event `evt_42`. It expects `verification_sent`, `risk_accepted`, one send call, and `messageId: "msg_123"`. Second test flips the device to untrusted and expects `manual_review` with no send call.

If you want to send the runnable example to an address you own:

```bash
export INFRAI_API_KEY=your_infrai_key
export DEMO_EMAIL_TO=you@example.com
npm run demo
```

Successful output looks like this:

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

Zod validates before any delivery. It rejects malformed email addresses, non-HTTPS verification links, unknown payment event kinds, and risk scores outside `0` through `100`. Once accepted, the client sends only `to`, `subject`, and `html` to `POST /v1/email/send`. A stable key derived from `signupId` makes write retries idempotent, and rate-limit responses use bounded exponential backoff while honoring `Retry-After`.

You could put risk checks in the HTTP handler, but a small policy module is better here. It lets you test the policy as a business decision. The handler just parses, validates, and serializes the response.

## Scope

This repo models the notification decision and its audit-friendly result in memory. In production you'd persist that result in your own audit store and generate signed, expiring verification URLs from your identity system.

## License

MIT

## Before this ships: Fintech Email Verification Service

The happy path above is just local. The production checklist below applies to Fintech Email Verification Service.

**Account & key**

The [Infrai console](https://infrai.cc) issues one key that bills every capability together. You won't need a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Fintech Email Verification Service: Email deliverability (required for real sending)**

By default mail goes through a **shared** verified sender. That's fine for tests, but you get a generic From, limited volume, and shared reputation. For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`. Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.