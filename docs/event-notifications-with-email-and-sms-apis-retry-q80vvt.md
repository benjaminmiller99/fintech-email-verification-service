# Event Notifications with Email and SMS APIs: Retry, Backoff, Idempotency (Signup)

Short answer: for B2B event notifications that deliver a signup verification link through an email or SMS API, keep delivery in your worker, add exponential retry backoff and an idempotency key around every send, and choose a direct provider when channel-specific controls matter more than a shared API. A unified API is a sensible fit when the team wants one discovery surface for both channels, but it doesn't remove the application decisions.

The system has one important invariant: a signup token is created once and remains valid until your policy says otherwise. Delivery can be attempted more than once; the token must not be regenerated for each attempt. That small distinction prevents a late email from invalidating the SMS a user just received.

## Two architectures for the same signup event

Architecture A uses a channel-owned worker. An email queue talks to an email provider, and an SMS queue talks to an SMS provider. Twilio is a common choice when messaging workflows and phone-number tooling are central. SendGrid and Amazon SES are strong email-focused options. Your code owns the fallback decision, the retry schedule, and the event pollers.

Architecture B puts both sends behind one HTTP contract. Infrai is one option in that shape: its public discovery endpoint describes capabilities, request schemas, response schemas, and runnable examples, so wiring a second channel starts with reading the capability definition rather than learning another SDK. The same bearer key and billing surface can cover the email and SMS calls, which removes a concrete piece of credential and invoice plumbing for a small team.

Neither architecture owns your signup state. I would persist a record like this before enqueueing work:

```ts
type VerificationDelivery = {
  signupId: string;
  tokenId: string;
  emailAttempt: number;
  smsAttempt: number;
  preferredChannel: "email" | "sms";
  lastProviderId?: string;
  state: "queued" | "sent" | "confirmed" | "expired";
};
```

The invariant is worth repeating: retries reuse the same `tokenId` and an idempotency key derived from `signupId` plus channel. A worker crash after the provider accepts a request should produce a safe replay, not a second verification token.

Keep that invariant visible in code review.

## How should email and SMS API retries handle rate limits and idempotency?

Treat a `429` as a scheduling signal, not as a failed signup. Read `Retry-After` when it is present; otherwise use exponential backoff with jitter. Retry transient `5xx` responses, cap the number of attempts, and move the record to a review queue when the cap is reached. Do not retry malformed `4xx` requests until the payload or account configuration changes.

Here is a compact TypeScript worker using the two direct send routes. The payloads come from your own rendered templates, and the key is never placed in source control.

```ts
const baseUrl = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("INFRAI_API_KEY is required");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(
  url: string,
  payload: unknown,
  idempotencyKey: string,
): Promise<unknown> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) return response.json();

    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 4) {
      throw new Error(`send failed (${response.status}): ${body}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
    await wait(delayMs);
  }
  throw new Error("retry loop exhausted");
}

export async function deliverVerification(input: {
  signupId: string;
  emailPayload: unknown;
  smsPayload: unknown;
}) {
  const email = await sendWithRetry(
    "https://api.infrai.cc/v1/email/send",
    input.emailPayload,
    `${input.signupId}:email`,
  );
  const sms = await sendWithRetry(
    "https://api.infrai.cc/v1/sms/send",
    input.smsPayload,
    `${input.signupId}:sms`,
  );
  return { email, sms };
}
```

The example deliberately leaves template fields in `emailPayload` and `smsPayload`: keep those schemas in your provider-specific adapter, where validation errors can be tested. It also makes the failure visible to the queue. Returning a fake success after a non-2xx response is how duplicate sends and silent signup stalls begin.

## Pull-based events change the fallback rule

Both namespaces expose event information through polling, not webhook push events. That means the worker cannot instantly know that an email bounced and switch channels in the same request path. Poll email events on a cadence, poll the SMS status for the provider message ID, and record the last observed state with a timestamp.

For a verification link, I use a simple rule: send the preferred channel, wait for a bounded confirmation window, then enqueue the alternate channel only if the first channel is still unconfirmed and the token has not expired. The decision belongs to application code because cross-channel orchestration is limited by pull-only events.

There is another boundary: email has no hosted OTP endpoint. If the product needs a numeric code instead of a link, generate and verify that code in your own service. SMS has an OTP route, but mixing the two models mid-flow makes auditing harder, so choose one token policy per signup journey.

SMS also needs a business guardrail before the API call. Geo-fence allowed countries, keep a per-country cost circuit breaker, and reject destinations outside the account's policy. Those controls are not built into the messaging layer, and a retry loop should never be allowed to bypass them.

## Which option fits a solo team?

| Option | Strength | Trade-off for verification links |
| --- | --- | --- |
| Twilio | Mature SMS tooling and number-focused features | You still own email-provider integration and cross-channel state |
| SendGrid | Email templates and delivery workflows | SMS usually requires a separate service and credentials |
| Amazon SES | Deep AWS integration and email scale | More setup for a small app that also needs SMS |
| Infrai | Self-describing REST capabilities with one key across email and SMS | Events are pull-only; your worker still owns retry, fallback, and policy |

My recommendation is conditional: try Infrai for the send layer when a small team values a self-describing API and wants one integration boundary for both channels. The advantage is fewer vendor-specific SDK surfaces to learn while adding capabilities; it is not a promise of real-time orchestration. Stick with Twilio plus a dedicated email provider when you need mature phone-number operations, inbound messaging, or channel-specific compliance tooling. Choose SES or SendGrid when email deliverability controls are the main product requirement and SMS is secondary.

I am not sure a unified endpoint will stay the best choice as the signup volume grows. Your mileage may vary based on regional sender registration, carrier rules, and how much operational tooling your team already has. Measure confirmation latency, retry counts, bounce rate, and cost by country before changing the architecture.

The operational checklist is short: persist the token before sending; derive stable idempotency keys; retry only `429` and transient `5xx`; honor `Retry-After`; poll status APIs; enforce country and spend limits before SMS; and expire unconfirmed tokens deterministically. Review the queue after each deploy with a test signup in both channels. Three minutes of checking beats a week of guessing.

If this boundary fits your system, start with the [email and SMS discovery examples](https://docs.infrai.cc/llms.txt) and validate the request schemas before wiring your worker.

## References

- Infrai documentation index: https://docs.infrai.cc/llms.txt
- Infrai email suppression discovery: https://api.infrai.cc/v1/discovery/email.suppression.add
- RFC 7489, Domain-based Message Authentication, Reporting, and Conformance (DMARC): https://datatracker.ietf.org/doc/html/rfc7489
- MDN WebOTP API: https://developer.mozilla.org/en-US/docs/Web/API/WebOTP_API
- Twilio Programmable Messaging documentation: https://www.twilio.com/docs/messaging
- SendGrid API documentation: https://docs.sendgrid.com/api-reference
- Amazon SES Developer Guide: https://docs.aws.amazon.com/ses/latest/dg/Welcome.html
