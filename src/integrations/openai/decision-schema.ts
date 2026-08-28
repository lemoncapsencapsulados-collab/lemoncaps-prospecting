import { z } from "zod";

export const conversationIntents = [
  "interested",
  "asked_info",
  "asked_pricing",
  "wants_whatsapp",
  "not_the_owner",
  "will_forward",
  "objection",
  "not_interested",
  "opt_out",
  "ambiguous",
  "needs_human",
] as const;

export const conversationActions = [
  "respond",
  "ask",
  "introduce",
  "handle_objection",
  "handoff_whatsapp",
  "wait",
  "schedule_follow_up",
  "close",
  "escalate_human",
] as const;

const responseActions = new Set<string>([
  "respond",
  "ask",
  "introduce",
  "handle_objection",
  "handoff_whatsapp",
]);

export const conversationDecisionSchema = z
  .object({
    intent: z.enum(conversationIntents),
    action: z.enum(conversationActions),
    responseText: z.string().trim().min(1).max(1_000).nullable(),
    confidence: z.number().min(0).max(1),
    reasoningSummary: z.string().trim().min(1).max(500),
    followUpAt: z.string().datetime({ offset: true }).nullable(),
    escalationReason: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (responseActions.has(decision.action) && !decision.responseText) {
      context.addIssue({
        code: "custom",
        path: ["responseText"],
        message: "responseText is required for a response action",
      });
    }
    if (decision.action === "schedule_follow_up" && !decision.followUpAt) {
      context.addIssue({
        code: "custom",
        path: ["followUpAt"],
        message: "followUpAt is required when scheduling a follow-up",
      });
    }
    if (decision.action === "escalate_human" && !decision.escalationReason) {
      context.addIssue({
        code: "custom",
        path: ["escalationReason"],
        message: "escalationReason is required for human escalation",
      });
    }
  });

export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;
