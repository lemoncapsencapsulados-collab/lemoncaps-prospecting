import { describe, expect, it } from "vitest";

import { evaluateFollowUp, type FollowUpContext } from "./follow-up";

describe("follow-up policy", () => {
  it("does not send a browser follow-up before an inbound reply", () => {
    const decision = evaluateFollowUp(
      context({ channelState: "waiting_inbound_reply", channelOwner: "browser", lastInboundAt: null }),
    );

    expect(decision).toEqual({ action: "close_without_send", reason: "no_inbound_reply" });
  });

  it("allows only an API follow-up inside the inbound messaging window", () => {
    expect(evaluateFollowUp(context())).toEqual({ action: "send_api_follow_up" });
  });

  it("closes without a send when the API window has expired", () => {
    expect(
      evaluateFollowUp(
        context({ now: new Date("2026-08-29T16:00:00.000Z") }),
      ),
    ).toEqual({ action: "close_without_send", reason: "api_window_expired" });
  });

  it("cancels outreach for opt-out, human review, block, pause, or integration failure", () => {
    expect(evaluateFollowUp(context({ doNotContact: true }))).toEqual({
      action: "close_without_send",
      reason: "do_not_contact",
    });
    expect(evaluateFollowUp(context({ channelState: "human_review_required", channelOwner: "human" }))).toEqual({
      action: "close_without_send",
      reason: "human_review_required",
    });
    expect(evaluateFollowUp(context({ integrationHealthy: false }))).toEqual({
      action: "close_without_send",
      reason: "instagram_unavailable",
    });
  });
});

function context(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    channelState: "api_active",
    channelOwner: "api",
    pipelineState: "replied",
    lastInboundAt: "2026-08-28T16:00:00.000Z",
    apiWindowExpiresAt: "2026-08-29T16:00:00.000Z",
    doNotContact: false,
    integrationHealthy: true,
    generalPaused: false,
    now: new Date("2026-08-28T17:00:00.000Z"),
    ...overrides,
  };
}
