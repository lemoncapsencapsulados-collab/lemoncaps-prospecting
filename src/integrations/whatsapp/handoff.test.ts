import { describe, expect, it } from "vitest";

import { loadBusinessConfig, type BusinessConfig } from "@/lib/business-config";

import { resolveHandoff } from "./handoff";

describe("independent destination handoff", () => {
  it("routes an interested customer to the configured WhatsApp link", () => {
    const config = business();

    expect(resolveHandoff(config, "customer")).toEqual({ kind: "link", url: config.whatsappLink });
  });

  it("escalates an affiliate handoff while the group link is pending", () => {
    expect(resolveHandoff(business({ affiliateGroupLink: null }), "affiliate")).toEqual({
      kind: "human_review",
      reason: "affiliate_group_link_missing",
    });
  });

  it("does not substitute WhatsApp for a missing affiliate group", () => {
    const config = business({ affiliateGroupLink: null });
    const decision = resolveHandoff(config, "affiliate");

    expect(decision.kind).toBe("human_review");
    expect(decision).not.toMatchObject({ url: config.whatsappLink });
  });
});

function business(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return { ...loadBusinessConfig("src/test/fixtures/business.json"), ...overrides };
}
