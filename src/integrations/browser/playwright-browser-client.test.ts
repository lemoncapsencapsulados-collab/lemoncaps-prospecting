import { describe, expect, it } from "vitest";

import { assertInstagramUrl } from "./playwright-browser-client";

describe("Instagram browser boundary", () => {
  it.each([
    "https://instagram.com/example/",
    "https://www.instagram.com/direct/t/123/",
  ])("accepts the official Instagram HTTPS host: %s", (url) => {
    expect(assertInstagramUrl(url)).toBe(url);
  });

  it.each([
    "http://www.instagram.com/example/",
    "https://instagram.example.com/example/",
    "https://evil.test/?next=https://www.instagram.com/example/",
  ])("rejects a non-Instagram navigation target: %s", (url) => {
    expect(() => assertInstagramUrl(url)).toThrow("Browser navigation is restricted to Instagram");
  });
});
