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

  it("requires exact OpenAI model IDs whenever an API key is configured", () => {
    expect(() =>
      loadEnv({ DATABASE_URL: "data/test.db", OPENAI_API_KEY: "test-key" }),
    ).toThrow("OPENAI_MODEL");
    expect(() =>
      loadEnv({
        DATABASE_URL: "data/test.db",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-5.6",
        OPENAI_MODEL_FAST: "gpt-latest",
      }),
    ).toThrow("exact model identifier");

    expect(
      loadEnv({
        DATABASE_URL: "data/test.db",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "gpt-5.6-sol",
        OPENAI_MODEL_FAST: "gpt-5.6-luna",
      }),
    ).toMatchObject({ openAiModel: "gpt-5.6-sol", openAiModelFast: "gpt-5.6-luna" });
  });

  it("loads a nullable affiliate group link without inventing one", () => {
    const business = loadBusinessConfig("src/test/fixtures/business.json");

    expect(business.affiliateGroupLink).toBeNull();
  });
});
