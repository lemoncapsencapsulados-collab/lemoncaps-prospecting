import { describe, expect, it } from "vitest";

import {
  affiliatePipelineStates,
  channelStates,
  customerPipelineStates,
  funnels,
} from "@/features/leads/types";
import {
  channelStateLabels,
  formatDateTime,
  formatUsd,
  funnelLabels,
  labelFor,
  pipelineStateLabels,
} from "./labels";

const internalIdentifier = /^[a-z0-9_]+$/;

describe("portuguese labels", () => {
  it("translates every pipeline state out of its internal identifier", () => {
    const states = [...customerPipelineStates, ...affiliatePipelineStates];

    for (const state of states) {
      const label = pipelineStateLabels[state];
      expect(label, `estado ${state}`).toBeTruthy();
      expect(label, `estado ${state}`).not.toMatch(internalIdentifier);
    }
  });

  it("translates every channel state out of its internal identifier", () => {
    for (const state of channelStates) {
      const label = channelStateLabels[state];
      expect(label, `canal ${state}`).toBeTruthy();
      expect(label, `canal ${state}`).not.toMatch(internalIdentifier);
    }
  });

  it("translates every funnel", () => {
    for (const funnel of funnels) {
      expect(funnelLabels[funnel]).not.toMatch(internalIdentifier);
    }
  });

  it("keeps an unmapped value visible instead of rendering blank", () => {
    expect(labelFor({ known: "Conhecido" }, "unmapped_value")).toBe("unmapped_value");
  });
});

describe("formatters", () => {
  it("renders timestamps in the operating timezone", () => {
    const formatted = formatDateTime("2026-08-28T15:30:00.000Z", "America/Cuiaba");

    expect(formatted).toContain("28/08/2026");
    expect(formatted).toContain("11:30");
  });

  it("returns a dash for missing or invalid timestamps", () => {
    expect(formatDateTime(null, "America/Cuiaba")).toBe("—");
    expect(formatDateTime("not-a-date", "America/Cuiaba")).toBe("—");
  });

  it("keeps extra precision for sub-dollar amounts so cost per lead stays readable", () => {
    expect(formatUsd(0.0123)).toContain("0,0123");
    expect(formatUsd(12.5)).toContain("12,50");
  });
});
