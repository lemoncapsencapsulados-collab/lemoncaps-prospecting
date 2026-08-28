import { describe, expect, it } from "vitest";

import { evaluateBrowserContactLimits } from "./limits";

describe("browser contact limits", () => {
  it("blocks a contact before the configured local operating window", () => {
    const decision = evaluateBrowserContactLimits(
      context({ now: new Date("2026-08-28T12:00:00.000Z") }),
    );

    expect(decision).toMatchObject({ allowed: false, reason: "outside_operating_hours" });
  });

  it("blocks the sixth contact in the first warmup week", () => {
    const decision = evaluateBrowserContactLimits(
      context({
        now: new Date("2026-08-28T14:00:00.000Z"),
        warmupStartedAt: new Date("2026-08-25T14:00:00.000Z"),
        sentToday: 5,
      }),
    );

    expect(decision).toEqual({ allowed: false, reason: "warmup_daily_limit_reached" });
  });

  it("allows a healthy eligible contact inside all limits", () => {
    const decision = evaluateBrowserContactLimits(
      context({
        now: new Date("2026-08-28T14:00:00.000Z"),
        warmupStartedAt: new Date("2026-07-01T14:00:00.000Z"),
        sentToday: 2,
        lastSentAt: new Date("2026-08-28T13:55:00.000Z"),
      }),
    );

    expect(decision).toEqual({ allowed: true });
  });
});

function context(
  overrides: Partial<Parameters<typeof evaluateBrowserContactLimits>[0]> = {},
): Parameters<typeof evaluateBrowserContactLimits>[0] {
  return {
    generalPaused: false,
    browserCircuitOpen: false,
    doNotContact: false,
    channelState: "browser_contact_pending",
    channelOwner: "browser",
    now: new Date("2026-08-28T14:00:00.000Z"),
    operatingHours: "09:00-20:00",
    operatingTimezone: "America/Cuiaba",
    maxDmsPerDay: 30,
    minSecondsBetweenDms: 90,
    maxSecondsBetweenDms: 240,
    warmupStartedAt: new Date("2026-07-01T14:00:00.000Z"),
    sentToday: 0,
    lastSentAt: null,
    spacingRandomValue: 0,
    ...overrides,
  };
}
