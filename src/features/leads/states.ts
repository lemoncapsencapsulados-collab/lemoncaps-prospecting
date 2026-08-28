import type {
  AffiliatePipelineState,
  ChannelState,
  CustomerPipelineState,
  Funnel,
  PipelineState,
} from "./types.ts";

type TransitionMap<State extends string> = Readonly<Record<State, readonly State[]>>;

export const customerTransitions: TransitionMap<CustomerPipelineState> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["whatsapp_handoff", "closed"],
  whatsapp_handoff: ["registered", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  closed: [],
};

export const affiliateTransitions: TransitionMap<AffiliatePipelineState> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["joined_affiliate_group", "closed"],
  joined_affiliate_group: ["active_affiliate", "closed"],
  active_affiliate: ["generated_customer", "closed"],
  generated_customer: ["closed"],
  closed: [],
};

export const channelTransitions: TransitionMap<ChannelState> = {
  browser_contact_pending: ["browser_contact_sent", "human_review_required", "do_not_contact", "blocked"],
  browser_contact_sent: ["waiting_inbound_reply", "human_review_required", "do_not_contact", "blocked"],
  waiting_inbound_reply: ["api_eligible", "human_review_required", "do_not_contact", "blocked", "completed"],
  api_eligible: ["api_active", "api_window_closed", "human_review_required", "do_not_contact", "blocked"],
  api_active: ["api_window_closed", "human_review_required", "do_not_contact", "blocked", "completed"],
  api_window_closed: ["human_review_required", "do_not_contact", "blocked", "completed"],
  human_review_required: ["api_active", "do_not_contact", "blocked", "completed"],
  do_not_contact: [],
  blocked: ["human_review_required", "completed"],
  completed: [],
};

export function canTransitionPipeline(funnel: Funnel, from: PipelineState, to: PipelineState): boolean {
  const transitions = funnel === "customer" ? customerTransitions : affiliateTransitions;
  return (transitions as Readonly<Record<string, readonly string[]>>)[from]?.includes(to) ?? false;
}

export function canTransitionChannel(from: ChannelState, to: ChannelState): boolean {
  return channelTransitions[from].includes(to);
}
