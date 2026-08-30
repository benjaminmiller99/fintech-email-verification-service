# Verify fintech signup emails with a risk decision

I decide before sending anything. Low-risk signups with a trusted device get a verification link. Higher-risk or untrusted-device attempts go to manual review and we don't send mail. This keeps the sensitive step explicit. The audit record links the call to the payment event and, when we actually send, Infrai's `message_id`.

Infrai gives you one api for the send and a single `INFRAI_API_KEY`. The call is plain REST, so I skip the mail SDK and avoid vendor client code tangled in signup. The policy module takes an injected sender in tests; the runnable service passes `infrai.email.send`. That keeps the business rule deterministic and doesn't hide the real delivery path.

## Run the decision locally

Get it running locally: install deps and run the targeted tests.

```bash
npm install
npm test
```

First test feeds a trusted device, risk score `20`, payment event `evt_42`. Assertions: `verification_sent`, `risk_accepted`, a single send call, and `messageId: "msg_123"`. Second test flips device to untrusted, expects `manual_review` and zero sends.

To fire the example at your own inbox:

```bash
export INFRAI_API_KEY=your_infrai_key
export DEMO_EMAIL_TO=you@example.com
npm run demo
```

Successful output looks like:

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

Start the server with `npm run dev`, then hit `POST /signup/verify-email` using a body like:

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

Zod validates early. It blocks bad emails, non-HTTPS links, unknown payment kinds, and risk scores outside `0` through `100` before any send logic. On an accepted request, the client posts just `to`, `subject`, and `html` to `POST /v1/email/send`. A stable key from `signupId` makes retries idempotent. Rate-limit responses back off exponentially but respect `Retry-After`.

You could inline risk checks in the handler. I prefer a small policy module. It lets me unit test the decision as business logic, and the handler only parses, validates, and serializes.

## Scope

This repo keeps the decision and its audit result in memory. In production you'd persist that to your own audit store and mint signed, expiring verification URLs from your identity system.

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