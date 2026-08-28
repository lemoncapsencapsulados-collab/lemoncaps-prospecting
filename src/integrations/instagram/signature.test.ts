import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createInstagramSignature, verifyInstagramSignature } from "./signature";

describe("Instagram webhook signatures", () => {
  const secret = "test-app-secret";
  const body = new TextEncoder().encode('{"object":"instagram"}');

  it("creates and verifies the exact raw-body HMAC", () => {
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(createInstagramSignature(body, secret)).toBe(expected);
    expect(verifyInstagramSignature(body, expected, secret)).toBe(true);
  });

  it("rejects malformed and tampered signatures without throwing", () => {
    expect(verifyInstagramSignature(body, "sha256=deadbeef", secret)).toBe(false);
    expect(verifyInstagramSignature(body, "sha1=deadbeef", secret)).toBe(false);
    expect(verifyInstagramSignature(body, null, secret)).toBe(false);
  });
});
