export const funnels = ["customer", "affiliate"] as const;
export type Funnel = (typeof funnels)[number];

export const customerPipelineStates = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "whatsapp_handoff",
  "registered",
  "active_customer",
  "closed",
] as const;
export type CustomerPipelineState = (typeof customerPipelineStates)[number];

export const affiliatePipelineStates = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "joined_affiliate_group",
  "active_affiliate",
  "generated_customer",
  "closed",
] as const;
export type AffiliatePipelineState = (typeof affiliatePipelineStates)[number];
export type PipelineState = CustomerPipelineState | AffiliatePipelineState;

export const channelStates = [
  "browser_contact_pending",
  "browser_contact_sent",
  "waiting_inbound_reply",
  "api_eligible",
  "api_active",
  "api_window_closed",
  "human_review_required",
  "do_not_contact",
  "blocked",
  "completed",
] as const;
export type ChannelState = (typeof channelStates)[number];
export type ChannelOwner = "browser" | "api" | "human" | "none";
export type LeadRole = "store" | "employee" | "owner" | "decision_maker" | "unknown";

export interface PublicProfileObservation {
  readonly instagramHandle: string;
  readonly displayName: string;
  readonly bio: string;
  readonly category: string;
  readonly location: string;
  readonly recentPosts: readonly string[];
  readonly hashtags: readonly string[];
  readonly relatedProfiles: readonly string[];
  readonly followerCount?: number;
  readonly publicEngagementRate?: number;
  readonly source: string;
  readonly proposedFunnel: Funnel;
}

export interface LeadRecord {
  readonly id: string;
  readonly instagramHandle: string;
  readonly normalizedHandle: string;
  readonly funnel: Funnel;
  readonly pipelineState: PipelineState;
  readonly channelState: ChannelState;
  readonly channelOwner: ChannelOwner;
  readonly displayName: string | null;
  readonly role: LeadRole | null;
  readonly niche: string | null;
  readonly source: string | null;
  readonly publicProfileJson: string;
  readonly score: number;
  readonly scoreBreakdownJson: string | null;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransitionContext {
  readonly leadId: string;
  readonly actor: "worker" | "operator" | "system" | "webhook";
  readonly reason: string;
  readonly correlationId: string;
}
