import type { ChannelOwner, ChannelState, PipelineState } from "@/features/leads/types";

export interface FollowUpContext {
  readonly channelState: ChannelState;
  readonly channelOwner: ChannelOwner;
  readonly pipelineState: PipelineState;
  readonly lastInboundAt: string | null;
  readonly apiWindowExpiresAt: string | null;
  readonly doNotContact: boolean;
  readonly integrationHealthy: boolean;
  readonly generalPaused: boolean;
  readonly now: Date;
}

export type FollowUpBlockReason =
  | "no_inbound_reply"
  | "api_window_expired"
  | "do_not_contact"
  | "human_review_required"
  | "lead_blocked"
  | "lead_closed"
  | "instagram_unavailable"
  | "general_pause"
  | "api_channel_not_owned";

export type FollowUpDecision =
  | { readonly action: "send_api_follow_up" }
  | { readonly action: "close_without_send"; readonly reason: FollowUpBlockReason };

export function evaluateFollowUp(context: FollowUpContext): FollowUpDecision {
  if (context.doNotContact || context.channelState === "do_not_contact") {
    return close("do_not_contact");
  }
  if (context.channelState === "human_review_required") return close("human_review_required");
  if (context.channelState === "blocked") return close("lead_blocked");
  if (context.pipelineState === "closed" || context.channelState === "completed") {
    return close("lead_closed");
  }
  if (!context.lastInboundAt) return close("no_inbound_reply");
  if (context.generalPaused) return close("general_pause");
  if (!context.integrationHealthy) return close("instagram_unavailable");
  if (
    context.channelOwner !== "api" ||
    (context.channelState !== "api_eligible" && context.channelState !== "api_active")
  ) {
    return close("api_channel_not_owned");
  }
  if (
    !context.apiWindowExpiresAt ||
    context.now.getTime() >= Date.parse(context.apiWindowExpiresAt)
  ) {
    return close("api_window_expired");
  }
  return { action: "send_api_follow_up" };
}

function close(reason: FollowUpBlockReason): FollowUpDecision {
  return { action: "close_without_send", reason };
}
