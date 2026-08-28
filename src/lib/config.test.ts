import { describe, expect, it } from "vitest";

import { loadBusinessConfig } from "./business-config";
import { loadEnv } from "./env";

describe("configuration", () => {
  it("defaults outbound integrations to simulated", () => {
    const env = loadEnv({ DATABASE_URL: "data/test.db" });

    expect(env.browserMode).toBe("simulated");
    expect(env.instagramMode).toBe("simulated");
  });

  it("rejects live browser mode without explicit authorization", () => {
    expect(() =>
      loadEnv({ DATABASE_URL: "data/test.db", BROWSER_MODE: "live" }),
    ).toThrow("BROWSER_LIVE_AUTHORIZED");
  });

  it("loads a nullable affiliate group link without inventing one", () => {
    const business = loadBusinessConfig("src/test/fixtures/business.json");

    expect(business.affiliateGroupLink).toBeNull();
  });
});
