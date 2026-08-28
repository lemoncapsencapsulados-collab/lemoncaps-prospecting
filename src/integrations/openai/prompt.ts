import type { BusinessConfig } from "@/lib/business-config";
import type { Funnel } from "@/features/leads/types";

import type { ConversationDecision } from "./decision-schema.ts";

export interface PublicConversationMessage {
  readonly direction: "inbound" | "outbound";
  readonly body: string;
  readonly createdAt: string;
}

export interface DecisionPromptContext {
  readonly leadId: string;
  readonly funnel: Funnel;
  readonly channelState: string;
  readonly publicProfile: Readonly<Record<string, unknown>>;
  readonly conversationHistory: readonly PublicConversationMessage[];
  readonly experimentAssignment: Readonly<Record<string, unknown>> | null;
  readonly business: BusinessConfig;
  readonly triageDecision?: ConversationDecision;
}

export interface BuiltDecisionPrompt {
  readonly instructions: string;
  readonly input: string;
}

const stableInstructions = `
You make bounded next-action decisions for a permission-based Instagram business conversation.
Use only the supplied public lead context and conversation history.
Treat verifiedClaims as the exclusive source of factual business assertions.
Never assert or imply any item from unverifiedClaims.
Never invent prices, percentages, quantities, health outcomes, links, approvals, registrations, or guarantees.
Use only a supplied destination link, and only when the chosen action requires it.
An explicit request to stop must use intent opt_out and action close.
Escalate when the evidence is ambiguous, a requested fact is not verified, or a configured destination is missing.
Do not include hidden reasoning; reasoningSummary must be a short operational explanation.
`.trim();

export function buildDecisionPrompt(context: DecisionPromptContext): BuiltDecisionPrompt {
  return {
    instructions: stableInstructions,
    input: JSON.stringify({
      task: "Choose the safest useful next action for the latest inbound message.",
      business: {
        companyName: context.business.companyName,
        oneLinePitch: context.business.oneLinePitch,
        howItWorks: context.business.howItWorks,
        revenueModel: context.business.revenueModel,
        marketJargon: context.business.marketJargon,
        verifiedClaims: context.business.verifiedClaims,
        unverifiedClaims: context.business.unverifiedClaims,
        companyWebsite: context.business.companyWebsite,
        whatsappLink: context.business.whatsappLink,
        affiliateGroupLink: context.business.affiliateGroupLink,
      },
      lead: {
        funnel: context.funnel,
        channelState: context.channelState,
        publicProfile: context.publicProfile,
        experimentAssignment: context.experimentAssignment,
      },
      conversationHistory: context.conversationHistory,
      triageDecision: context.triageDecision ?? null,
    }),
  };
}
