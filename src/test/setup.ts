import { afterEach } from "vitest";

afterEach(() => {
  delete process.env.BROWSER_LIVE_AUTHORIZED;
  delete process.env.INSTAGRAM_LIVE_AUTHORIZED;
});
