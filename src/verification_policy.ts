import { z } from "zod";
import { infrai, type SentEmail } from "./infrai_email.js";

export const signupRequest = z.object({
  signupId: z.string().uuid(),
  email: z.string().email(),
  verificationUrl: z.string().url().startsWith("https://"),
  paymentEvent: z.object({
    eventId: z.string().min(1),
    kind: z.enum(["card_attached", "bank_linked", "deposit_initiated"]),
    amountCents: z.number().int().nonnegative(),
  }),
  risk: z.object({
    score: z.number().int().min(0).max(100),
    deviceTrusted: z.boolean(),
  }),
});

export type SignupRequest = z.infer<typeof signupRequest>;
type SendVerification = (
  body: { to: string; subject: string; html: string },
  idempotencyKey: string,
) => Promise<SentEmail>;

export type AuditNotification = {
  signupId: string;
  paymentEventId: string;
  paymentEventKind: SignupRequest["paymentEvent"]["kind"];
  decision: "verification_sent" | "manual_review";
  reason: "risk_accepted" | "risk_review_required";
  messageId?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] as string);
}

export async function decideSignupNotification(
  input: SignupRequest,
  send: SendVerification = infrai.email.send,
): Promise<AuditNotification> {
  const reviewRequired = input.risk.score >= 70 || !input.risk.deviceTrusted;
  if (reviewRequired) {
    return {
      signupId: input.signupId,
      paymentEventId: input.paymentEvent.eventId,
      paymentEventKind: input.paymentEvent.kind,
      decision: "manual_review",
      reason: "risk_review_required",
    };
  }

  const sent = await send({
    to: input.email,
    subject: "Verify your email for your fintech account",
    html: `<p>Confirm your email to continue your signup.</p><p><a href="${escapeHtml(input.verificationUrl)}">Verify email</a></p>`,
  }, `signup-verification:${input.signupId}`);

  return {
    signupId: input.signupId,
    paymentEventId: input.paymentEvent.eventId,
    paymentEventKind: input.paymentEvent.kind,
    decision: "verification_sent",
    reason: "risk_accepted",
    messageId: sent.message_id,
  };
}
