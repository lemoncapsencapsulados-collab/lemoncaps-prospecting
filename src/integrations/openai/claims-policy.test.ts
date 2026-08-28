import { describe, expect, it } from "vitest";

import { loadBusinessConfig, type BusinessConfig } from "@/lib/business-config";

import { enforceClaimsPolicy } from "./claims-policy";

describe("deterministic claims policy", () => {
  it("rejects an outbound response containing a normalized unverified health claim", () => {
    const result = enforceClaimsPolicy(
      "Este produto CURA   doenças.",
      business({ unverifiedClaims: ["Cura doenças"] }),
    );

    expect(result).toEqual({ allowed: false, reason: "unverified_claim" });
  });

  it("allows configured verified claims and destinations", () => {
    const config = business();
    const result = enforceClaimsPolicy(
      `Somos uma empresa brasileira. Saiba mais em ${config.companyWebsite}`,
      config,
    );

    expect(result).toEqual({ allowed: true });
  });

  it("blocks a made-up affiliate destination while the group link is pending", () => {
    const result = enforceClaimsPolicy(
      "Entre em https://example.com/grupo",
      business({ affiliateGroupLink: null }),
    );

    expect(result).toEqual({ allowed: false, reason: "unconfigured_link" });
  });

  it("blocks unsupported price, percentage, and quantity claims", () => {
    const config = business();

    expect(enforceClaimsPolicy("Custa apenas R$ 49,90", config)).toEqual({
      allowed: false,
      reason: "unsupported_numeric_claim",
    });
    expect(enforceClaimsPolicy("Você terá 80% de resultado", config)).toEqual({
      allowed: false,
      reason: "unsupported_numeric_claim",
    });
    expect(enforceClaimsPolicy("Entregamos em 3 dias", config)).toEqual({
      allowed: false,
      reason: "unsupported_numeric_claim",
    });
  });
});

function business(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return { ...loadBusinessConfig("src/test/fixtures/business.json"), ...overrides };
}
