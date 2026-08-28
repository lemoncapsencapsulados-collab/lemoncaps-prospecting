import { afterEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "@/db/test-database";
import type { AppDatabase } from "@/db/client";
import { loadBusinessConfig } from "@/lib/business-config";
import { discoverLead, qualifyLead, readLead } from "./lead-service";

let database: AppDatabase | undefined;

afterEach(() => database?.close());

describe("lead discovery and qualification", () => {
  it("returns the same lead for a case-insensitive duplicate handle", () => {
    database = createTestDatabase();

    const first = discoverLead(database, profile("@Health.Store"));
    const duplicate = discoverLead(database, profile("health.store"));
    const count = database.sqlite.prepare("SELECT COUNT(*) AS count FROM leads").get() as { count: number };

    expect(duplicate).toEqual({ leadId: first.leadId, created: false, suppressed: false });
    expect(count.count).toBe(1);
  });

  it("qualifies a matching owner and stores the score breakdown", () => {
    database = createTestDatabase();
    const business = loadBusinessConfig("src/test/fixtures/business.json");
    const discovered = discoverLead(
      database,
      profile("@qualified.owner", {
        bio: "Fundador de marca com palavra-chave e produtos para saúde",
        category: "Empreendedor",
      }),
    );

    const result = qualifyLead(database, discovered.leadId, business, {
      actor: "worker",
      correlationId: "qualification-1",
    });
    const lead = readLead(database, discovered.leadId);

    expect(result.qualified).toBe(true);
    expect(result.role).toBe("owner");
    expect(result.keywordMatches).toEqual(["palavra-chave"]);
    expect(lead.pipelineState).toBe("qualified");
    expect(lead.score).toBeGreaterThanOrEqual(40);
    expect(JSON.parse(lead.scoreBreakdownJson!)).toMatchObject({ role: "owner" });
  });
});

function profile(
  instagramHandle: string,
  overrides: Partial<{
    bio: string;
    category: string;
  }> = {},
) {
  return {
    instagramHandle,
    displayName: "Health Store",
    bio: overrides.bio ?? "Conteúdo de bem-estar",
    category: overrides.category ?? "Saúde e beleza",
    location: "Brasil",
    recentPosts: ["Conteúdo público recente"],
    hashtags: ["#saude"],
    relatedProfiles: [],
    source: "keyword:saúde",
    proposedFunnel: "customer" as const,
  };
}
