import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInstagramSignature } from "@/integrations/instagram/signature";

import { GET, POST } from "./route";

const envKeys = [
  "DATABASE_URL",
  "INSTAGRAM_APP_SECRET",
  "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
] as const;
const previousEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  process.env.DATABASE_URL = ":memory:";
  process.env.INSTAGRAM_APP_SECRET = "route-app-secret";
  process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = "route-verify-token";
});

afterEach(() => {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

describe("Instagram webhook route", () => {
  it("returns the plain verification challenge", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=route-verify-token&hub.challenge=abc123",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("rejects the wrong verification token", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123",
      ),
    );

    expect(response.status).toBe(403);
  });

  it("passes the untouched request bytes to signature verification", async () => {
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        object: "instagram",
        entry: [
          {
            id: "business-account",
            time: 1_787_936_400_000,
            messaging: [
              {
                sender: { id: "unknown-sender" },
                recipient: { id: "business-account" },
                timestamp: 1_787_936_400_000,
                message: { mid: "mid.route.1", text: "Olá" },
              },
            ],
          },
        ],
      }),
    );
    const response = await POST(
      new Request("http://localhost/api/webhooks/instagram", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": createInstagramSignature(rawBody, "route-app-secret"),
        },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 0, duplicates: 0, ignored: 0, unmatched: 1 });
  });
});
