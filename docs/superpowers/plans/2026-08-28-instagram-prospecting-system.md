# Instagram Prospecting System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove a local autonomous Instagram prospecting system with guarded browser contact, official Meta continuation, two measurable funnels, strict claims enforcement, and a PT-BR operations dashboard.

**Architecture:** A single Next.js modular monolith runs a web process and a durable SQLite worker from one pnpm command. Feature modules own domain rules, integration modules expose concrete simulated/dry-run/live adapters, and transactional SQLite state plus idempotency keys coordinate all channel actions.

**Tech Stack:** Node.js 24.14.1, pnpm 11.24.0, Next.js 16.3.3, React 19.2.8, TypeScript 7.0.2 strict, Tailwind CSS 4.3.3, SQLite via better-sqlite3 13.0.3, Drizzle ORM 0.45.2, Playwright 1.62.1, OpenAI SDK 7.8.0, Zod 4.4.3, and Vitest 4.1.11.

**Spec:** `docs/superpowers/specs/2026-08-28-instagram-prospecting-system-design.md`

## Global Constraints

- Use a modular monolith; do not add microservices, Redis, PostgreSQL, packages, or empty architecture layers.
- Keep all operator-facing content in PT-BR and all code, schema, internal statuses, logs, tests, and developer documentation in English.
- Store real business data only in ignored `config/business.json`; store credentials only in ignored `.env`.
- Default every outbound integration to `simulated`; `dry_run` blocks the final action and `live` requires an explicit authorization flag.
- Use `verifiedClaims` as the only factual assertion source and fail closed on unsupported claims, numbers, commercial conditions, guarantees, health-treatment language, or unconfigured links.
- Use SQLite foreign keys, WAL, busy timeout, UTC timestamps, versioned migrations, transactional critical transitions, stable idempotency keys, leases, bounded retries, dead-letter state, and audit logs.
- Connect to Chrome only with `chromium.connectOverCDP(CHROME_CDP_URL)`, reuse `browser.contexts()[0]`, create a dedicated page, never call `bringToFront()`, never launch a fallback browser, and always close the page in `finally`.
- Never use private Instagram APIs, fingerprint forgery, automation masking, or a browser fallback after API handoff.
- Run lint, strict type checking, all tests, production build, migrations, and the complete simulated end-to-end evidence scenario before claiming completion.

---

### Task 1: Toolchain, App Shell, and Validated Configuration

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/lib/env.ts`
- Create: `src/lib/business-config.ts`
- Create: `.env.example`
- Create: `config/business.example.json`
- Create: `.gitignore`
- Test: `src/lib/config.test.ts`

**Interfaces:**
- Consumes: process environment and a JSON business configuration path.
- Produces: `loadEnv(source: NodeJS.ProcessEnv): AppEnv`, `loadBusinessConfig(path: string): BusinessConfig`, and the root PT-BR application shell.

- [ ] **Step 1: Create the pinned package manifest and test configuration**

```json
{
  "name": "instagram-prospecting-operator",
  "version": "1.0.0",
  "private": true,
  "packageManager": "pnpm@11.24.0",
  "engines": { "node": ">=24.0.0 <25" },
  "scripts": {
    "dev": "concurrently -k -n WEB,WORKER \"next dev\" \"tsx watch src/worker/main.ts\"",
    "build": "next build",
    "start": "concurrently -k -n WEB,WORKER \"next start\" \"tsx src/worker/main.ts\"",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/db/migrate.ts",
    "evidence": "tsx scripts/run-evidence.ts"
  },
  "dependencies": {
    "better-sqlite3": "13.0.3",
    "drizzle-orm": "0.45.2",
    "next": "16.3.3",
    "openai": "7.8.0",
    "playwright": "1.62.1",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "server-only": "0.0.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/better-sqlite3": "9.6.0",
    "@types/node": "26.4.0",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.5",
    "concurrently": "10.0.5",
    "drizzle-kit": "0.31.10",
    "eslint": "10.9.1",
    "eslint-config-next": "16.3.3",
    "postcss": "8.5.26",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.12",
    "typescript": "7.0.2",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 2: Write configuration tests that fail before loaders exist**

```ts
import { describe, expect, it } from "vitest";
import { loadBusinessConfig } from "./business-config";
import { loadEnv } from "./env";

describe("configuration", () => {
  it("defaults outbound integrations to simulated", () => {
    const env = loadEnv({ DATABASE_URL: "data/test.db" });
    expect(env.browserMode).toBe("simulated");
    expect(env.instagramMode).toBe("simulated");
  });

  it("rejects live mode without explicit authorization", () => {
    expect(() => loadEnv({ DATABASE_URL: "data/test.db", BROWSER_MODE: "live" }))
      .toThrow("BROWSER_LIVE_AUTHORIZED");
  });

  it("loads a nullable affiliate group link without inventing one", () => {
    const business = loadBusinessConfig("src/test/fixtures/business.json");
    expect(business.affiliateGroupLink).toBeNull();
  });
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `corepack pnpm vitest run src/lib/config.test.ts`

Expected: FAIL because `./business-config` and `./env` do not exist.

- [ ] **Step 4: Implement strict Zod loaders, placeholder examples, ignored paths, and the PT-BR shell**

```ts
export const appEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BROWSER_MODE: z.enum(["simulated", "dry_run", "live"]).default("simulated"),
  INSTAGRAM_MODE: z.enum(["simulated", "dry_run", "live"]).default("simulated"),
  BROWSER_LIVE_AUTHORIZED: booleanString.default(false),
  INSTAGRAM_LIVE_AUTHORIZED: booleanString.default(false),
  MAX_DMS_PER_DAY: z.coerce.number().int().positive().default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().positive().default(240),
  OPERATING_HOURS: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().default("America/Cuiaba")
});

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  const env = appEnvSchema.parse(source);
  if (env.BROWSER_MODE === "live" && !env.BROWSER_LIVE_AUTHORIZED) {
    throw new Error("BROWSER_LIVE_AUTHORIZED must be true for live browser mode");
  }
  if (env.INSTAGRAM_MODE === "live" && !env.INSTAGRAM_LIVE_AUTHORIZED) {
    throw new Error("INSTAGRAM_LIVE_AUTHORIZED must be true for live Instagram mode");
  }
  return mapAppEnv(env);
}
```

The business schema defines `ownerName`, `ownerRole`, `companyName`, `companyWebsite`, `instagramHandle`, `whatsappLink`, nullable `affiliateGroupLink`, `oneLinePitch`, `howItWorks`, `revenueModel`, `marketJargon`, `verifiedClaims`, `unverifiedClaims`, `icpSegments`, `icpKeywords`, `affiliateTopics`, and `geography`.

- [ ] **Step 5: Install dependencies and confirm GREEN**

Run: `corepack pnpm install && corepack pnpm vitest run src/lib/config.test.ts && corepack pnpm typecheck`

Expected: lockfile created; configuration tests and typecheck PASS.

- [ ] **Step 6: Commit the foundation**

```powershell
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts src config .env.example .gitignore
git commit -m "feat: scaffold validated local operator app"
```

### Task 2: SQLite Schema, Versioned Migration, and Safe Backup

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/db/migrations/0000_initial.sql`
- Create: `src/db/migrate.ts`
- Create: `src/db/backup.ts`
- Create: `src/db/test-database.ts`
- Test: `src/db/database.test.ts`

**Interfaces:**
- Consumes: `AppEnv.databaseUrl` from Task 1.
- Produces: `createDatabase(path: string): AppDatabase`, `migrateDatabase(db: AppDatabase): void`, `createVerifiedBackup(db, destination): BackupResult`, and exported Drizzle table definitions.

- [ ] **Step 1: Write failing database invariant tests**

```ts
it("enforces a unique normalized Instagram handle", () => {
  const db = createTestDatabase();
  insertLead(db, { instagramHandle: "@Example", normalizedHandle: "example", funnel: "customer" });
  expect(() => insertLead(db, { instagramHandle: "example", normalizedHandle: "example", funnel: "affiliate" }))
    .toThrow(/UNIQUE/);
});

it("restores a verified backup into an independent database", () => {
  const source = createTestDatabase();
  seedLead(source, "backup-proof");
  const result = createVerifiedBackup(source, temporaryBackupPath());
  expect(result.integrityCheck).toBe("ok");
  expect(readLeadFromDatabase(result.path, "backup-proof")).toBeDefined();
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `corepack pnpm vitest run src/db/database.test.ts`

Expected: FAIL because database modules do not exist.

- [ ] **Step 3: Define the concrete schema and migration**

```ts
export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  instagramHandle: text("instagram_handle").notNull(),
  normalizedHandle: text("normalized_handle").notNull().unique(),
  funnel: text("funnel", { enum: ["customer", "affiliate"] }).notNull(),
  pipelineState: text("pipeline_state").notNull(),
  channelState: text("channel_state").notNull(),
  channelOwner: text("channel_owner", { enum: ["browser", "api", "human", "none"] }).notNull(),
  publicProfileJson: text("public_profile_json").notNull(),
  score: integer("score").notNull().default(0),
  nextActionAt: text("next_action_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
```

Add all tables named in the design, foreign keys, partial uniqueness for one active conversation, unique message external IDs, unique outbound idempotency keys, job lease fields, event correlation IDs, and migration ledger table. Configure `journal_mode = WAL`, `foreign_keys = ON`, and `busy_timeout = 5000` in `createDatabase`.

- [ ] **Step 4: Implement safe migration and backup verification**

```ts
export function createVerifiedBackup(db: AppDatabase, destination: string): BackupResult {
  ensureIgnoredBackupDirectory(destination);
  db.sqlite.backup(destination);
  const verification = new Database(destination, { readonly: true });
  const integrityCheck = verification.pragma("integrity_check", { simple: true });
  verification.close();
  if (integrityCheck !== "ok") throw new Error("Backup integrity verification failed");
  return { path: destination, integrityCheck: "ok" };
}
```

- [ ] **Step 5: Run migration and database tests**

Run: `corepack pnpm db:migrate && corepack pnpm vitest run src/db/database.test.ts`

Expected: migration succeeds; uniqueness, foreign key, WAL, and backup tests PASS.

- [ ] **Step 6: Commit the data foundation**

```powershell
git add drizzle.config.ts src/db
git commit -m "feat: add durable SQLite data model"
```

### Task 3: Lead Domain, State Machines, Deduplication, and Opt-out

**Files:**
- Create: `src/features/leads/types.ts`
- Create: `src/features/leads/states.ts`
- Create: `src/features/leads/lead-service.ts`
- Create: `src/features/leads/qualification.ts`
- Create: `src/features/leads/do-not-contact.ts`
- Test: `src/features/leads/lead-service.test.ts`
- Test: `src/features/leads/states.test.ts`
- Test: `src/features/leads/do-not-contact.test.ts`

**Interfaces:**
- Consumes: `AppDatabase`, business ICP configuration, and `PublicProfileObservation`.
- Produces: `discoverLead(db, observation): DiscoverLeadResult`, `qualifyLead(db, leadId, config): QualificationResult`, `transitionPipeline(db, input): Lead`, `transitionChannel(db, input): Lead`, and `optOutLead(db, leadId, reason): void`.

- [ ] **Step 1: Write failing domain tests**

```ts
it("returns the existing lead for case-insensitive duplicate discovery", () => {
  const first = discoverLead(db, profile("@Health.Store"));
  const duplicate = discoverLead(db, profile("health.store"));
  expect(duplicate.leadId).toBe(first.leadId);
  expect(countRows(db, "leads")).toBe(1);
});

it("rejects an invalid customer pipeline transition", () => {
  const lead = seedCustomerLead(db, "discovered");
  expect(() => transitionPipeline(db, { leadId: lead.id, to: "active_customer", reason: "skip" }))
    .toThrow("Invalid customer pipeline transition");
});

it("permanently suppresses every pending contact after opt-out", () => {
  const lead = seedLeadWithPendingJobs(db);
  optOutLead(db, lead.id, "pare");
  expect(readLead(db, lead.id).channelState).toBe("do_not_contact");
  expect(countRunnableLeadJobs(db, lead.id)).toBe(0);
  expect(() => discoverLead(db, profile(lead.instagramHandle))).not.toScheduleContact();
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `corepack pnpm vitest run src/features/leads`

Expected: FAIL because lead services and transition maps do not exist.

- [ ] **Step 3: Implement explicit transition maps and transactional audit events**

```ts
export const customerTransitions = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["whatsapp_handoff", "closed"],
  whatsapp_handoff: ["registered", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  closed: []
} as const satisfies TransitionMap<CustomerPipelineState>;
```

Normalize handles by trimming whitespace, removing one leading `@`, and lowercasing. Insert or return inside one transaction. Store every transition with previous state, next state, actor, reason, and correlation ID.

- [ ] **Step 4: Implement deterministic qualification and permanent suppression**

```ts
export function scoreProfile(profile: PublicProfileObservation, config: BusinessConfig): QualificationResult {
  const searchable = normalizeSearchText([profile.bio, profile.category, ...profile.hashtags].join(" "));
  const keywordMatches = config.icpKeywords.filter((keyword) => searchable.includes(normalizeSearchText(keyword)));
  const topicMatches = config.affiliateTopics.filter((topic) => searchable.includes(normalizeSearchText(topic)));
  const score = Math.min(100, keywordMatches.length * 25 + topicMatches.length * 15 + roleWeight(profile));
  return { score, keywordMatches, topicMatches, role: classifyRole(profile), qualified: score >= 40 };
}
```

`optOutLead` must insert into `do_not_contact`, cancel scheduled/running-unleased contact jobs, change channel ownership to `none`, update state to `do_not_contact`, and append audit/event rows atomically.

- [ ] **Step 5: Run all lead tests and refactor while green**

Run: `corepack pnpm vitest run src/features/leads`

Expected: dedupe, both pipeline maps, channel map, qualification, and opt-out tests PASS.

- [ ] **Step 6: Commit the lead domain**

```powershell
git add src/features/leads
git commit -m "feat: enforce auditable lead lifecycle"
```

### Task 4: Durable Jobs, Browser Mutex, Limits, and Circuit Breakers

**Files:**
- Create: `src/worker/job-types.ts`
- Create: `src/worker/job-store.ts`
- Create: `src/worker/runner.ts`
- Create: `src/worker/limits.ts`
- Create: `src/worker/circuit-breaker.ts`
- Create: `src/worker/main.ts`
- Test: `src/worker/job-store.test.ts`
- Test: `src/worker/runner.test.ts`
- Test: `src/worker/limits.test.ts`
- Test: `src/worker/circuit-breaker.test.ts`

**Interfaces:**
- Consumes: `AppDatabase`, `AppEnv`, and `JobHandlerMap`.
- Produces: `enqueueJob`, `leaseDueJob`, `completeJob`, `failJob`, `recoverExpiredLeases`, `canSendBrowserContact`, `acquireBrowserMutex`, and `recordIntegrationFailure`.

- [ ] **Step 1: Write failing recovery, idempotency, and safety tests**

```ts
it("recovers an expired running job once after restart", () => {
  seedExpiredRunningJob(db, "qualify:lead-1");
  expect(recoverExpiredLeases(db, now)).toBe(1);
  expect(recoverExpiredLeases(db, now)).toBe(0);
  expect(leaseDueJob(db, "worker-b", now)?.idempotencyKey).toBe("qualify:lead-1");
});

it("opens the browser circuit and pauses browser jobs at the failure threshold", () => {
  recordIntegrationFailure(db, "browser", "session_lost", thresholdFailures());
  expect(readIntegrationHealth(db, "browser").circuitState).toBe("open");
  expect(canSendBrowserContact(context())).toEqual({ allowed: false, reason: "browser_circuit_open" });
});

it("blocks sends outside the operating window and warmup allowance", () => {
  expect(canSendBrowserContact(context({ localTime: "20:01" })).allowed).toBe(false);
  expect(canSendBrowserContact(context({ warmupSent: 5, warmupLimit: 5 })).allowed).toBe(false);
});
```

- [ ] **Step 2: Run worker tests and confirm RED**

Run: `corepack pnpm vitest run src/worker`

Expected: FAIL because job store, safety policies, and circuit breaker do not exist.

- [ ] **Step 3: Implement transactional leasing and bounded retries**

```ts
export function leaseDueJob(db: AppDatabase, workerId: string, now: Date): JobRecord | null {
  return db.transaction(() => {
    const candidate = findOldestDueQueuedJob(db, now);
    if (!candidate) return null;
    const leased = claimJobIfStillQueued(db, candidate.id, workerId, addSeconds(now, 60));
    return leased ? readJob(db, candidate.id) : null;
  });
}

export function failJob(db: AppDatabase, job: JobRecord, error: Error, now: Date): void {
  const attempts = job.attempts + 1;
  const status = attempts >= job.maxAttempts ? "dead_letter" : "queued";
  const nextRunAt = status === "queued" ? addSeconds(now, Math.min(300, 2 ** attempts)) : null;
  persistJobFailure(db, { jobId: job.id, attempts, status, nextRunAt, lastError: sanitizeError(error) });
}
```

- [ ] **Step 4: Implement the database mutex and complete limit evaluation**

The limit decision checks global pause, integration circuit, lead state, do-not-contact, channel owner, operating hours in `OPERATING_TIMEZONE`, warmup week, daily count, and randomized spacing bounds. It returns a typed denial reason and next eligible UTC timestamp.

- [ ] **Step 5: Run worker tests and recovery integration test**

Run: `corepack pnpm vitest run src/worker && corepack pnpm typecheck`

Expected: leasing, recovery, mutex, limits, circuit, retry, and dead-letter tests PASS.

- [ ] **Step 6: Commit durable execution**

```powershell
git add src/worker
git commit -m "feat: add recoverable local job worker"
```

### Task 5: Experiments, Metrics, and Reversible Adaptation

**Files:**
- Create: `src/features/experiments/experiment-service.ts`
- Create: `src/features/experiments/assignment.ts`
- Create: `src/features/experiments/metrics.ts`
- Create: `src/features/experiments/adaptation.ts`
- Test: `src/features/experiments/experiment-service.test.ts`
- Test: `src/features/experiments/adaptation.test.ts`

**Interfaces:**
- Consumes: funnel outcome events and lead identifiers.
- Produces: `assignVariant(db, experimentId, leadId): Assignment`, `measureExperiment(db, id): ExperimentReport`, and `adaptExperiment(db, id, policy): AdaptationResult`.

- [ ] **Step 1: Write failing sticky-assignment and minimum-sample tests**

```ts
it("returns the same variant for repeated assignment", () => {
  const first = assignVariant(db, experiment.id, lead.id);
  const second = assignVariant(db, experiment.id, lead.id);
  expect(second.variantId).toBe(first.variantId);
  expect(countAssignments(db, experiment.id, lead.id)).toBe(1);
});

it("does not promote a variant before the registered minimum sample", () => {
  seedExperimentOutcomes(db, { control: 4, challenger: 5 });
  expect(adaptExperiment(db, experiment.id, policy({ minimumSamplePerVariant: 20 })).changed).toBe(false);
});
```

- [ ] **Step 2: Run experiment tests and confirm RED**

Run: `corepack pnpm vitest run src/features/experiments`

Expected: FAIL because experiment functions do not exist.

- [ ] **Step 3: Implement deterministic weighted sticky assignment**

```ts
export function chooseWeightedVariant(leadId: string, experimentId: string, variants: WeightedVariant[]): string {
  const bucket = stableHash(`${experimentId}:${leadId}`) % 10_000;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.allocationBasisPoints;
    if (bucket < cursor) return variant.id;
  }
  throw new Error("Variant allocations must total 10000 basis points");
}
```

- [ ] **Step 4: Implement prioritized outcomes and reversible allocation changes**

Customer ranking weights outcomes from `active_customer` down to `replied`; affiliate ranking weights `generated_customer` down to `replied`. Adaptation changes at most 1,000 basis points per run, preserves at least 1,000 exploration basis points, writes evidence and rollback allocation, and rejects experiments that change more than one declared variable.

- [ ] **Step 5: Run experiment tests**

Run: `corepack pnpm vitest run src/features/experiments`

Expected: assignment, measurement, no-early-winner, exploration, and rollback tests PASS.

- [ ] **Step 6: Commit experimentation**

```powershell
git add src/features/experiments
git commit -m "feat: measure and adapt controlled experiments"
```

### Task 6: Playwright CDP First-contact Integration

**Files:**
- Create: `src/integrations/browser/browser-types.ts`
- Create: `src/integrations/browser/fake-browser-client.ts`
- Create: `src/integrations/browser/playwright-browser-client.ts`
- Create: `src/integrations/browser/first-contact.ts`
- Create: `src/integrations/browser/evidence.ts`
- Create: `src/integrations/browser/simulated-instagram.html`
- Test: `src/integrations/browser/first-contact.test.ts`
- Test: `src/integrations/browser/playwright-browser-client.test.ts`

**Interfaces:**
- Consumes: `BrowserClient`, an approved `FirstContactCommand`, limits, database mutex, and runtime mode.
- Produces: `sendFirstContact(deps, command): Promise<FirstContactResult>` and concrete fake/Playwright clients.

- [ ] **Step 1: Write failing behavioral tests with a fake client**

```ts
it("uses a dedicated page and always closes it after simulated contact", async () => {
  const fake = new FakeBrowserClient();
  await sendFirstContact(deps({ client: fake, mode: "simulated" }), command());
  expect(fake.events).toEqual(["connect", "reuse-context-0", "new-page", "navigate-instagram", "type", "send", "close-page"]);
});

it("blocks the final action in dry-run mode", async () => {
  const fake = new FakeBrowserClient();
  const result = await sendFirstContact(deps({ client: fake, mode: "dry_run" }), command());
  expect(result.status).toBe("dry_run_blocked");
  expect(fake.events).not.toContain("send");
});

it("opens the circuit without launching a browser when CDP is unavailable", async () => {
  const fake = FakeBrowserClient.unavailable();
  await expect(sendFirstContact(deps({ client: fake }), command())).rejects.toThrow("browser_unavailable");
  expect(fake.events).not.toContain("launch");
  expect(readIntegrationHealth(db, "browser").circuitState).toBe("open");
});
```

- [ ] **Step 2: Run browser tests and confirm RED**

Run: `corepack pnpm vitest run src/integrations/browser`

Expected: FAIL because browser client and first-contact orchestration do not exist.

- [ ] **Step 3: Implement the fake client and mode-safe orchestration**

```ts
export async function sendFirstContact(deps: BrowserContactDependencies, command: FirstContactCommand): Promise<FirstContactResult> {
  const decision = deps.evaluateLimits(command);
  if (!decision.allowed) return { status: "deferred", reason: decision.reason, nextRunAt: decision.nextRunAt };
  return deps.withBrowserMutex(async () => {
    const session = await deps.client.connect();
    const page = await session.contexts[0]?.newPage();
    if (!page) throw new BrowserUnavailableError("browser_unavailable");
    try {
      await page.navigate(assertInstagramUrl(command.profileUrl));
      await page.typeMessage(command.message, deps.typingDelayMs);
      if (deps.mode === "dry_run") return deps.recordDryRun(command, page);
      await page.send();
      return deps.recordSent(command);
    } finally {
      await page.close();
    }
  });
}
```

- [ ] **Step 4: Implement the concrete CDP client and failure evidence**

Use `chromium.connectOverCDP(url)`, require `browser.contexts()[0]`, call only `context.newPage()`, install console and failed-request listeners, and use accessibility role/text locators. Do not expose a `launch` method and do not import Chromium outside this client. Capture screenshot, accessibility snapshot, URL, console errors, failed requests, and job ID on error.

- [ ] **Step 5: Run browser tests and validate forbidden-call scan**

Run: `corepack pnpm vitest run src/integrations/browser && rg "bringToFront|chromium\.launch|launchPersistentContext" src/integrations/browser`

Expected: tests PASS; `rg` returns no matches.

- [ ] **Step 6: Commit the browser boundary**

```powershell
git add src/integrations/browser
git commit -m "feat: add guarded CDP first contact"
```

### Task 7: Signed Meta Webhook, Idempotent Handoff, and Official Send API

**Files:**
- Create: `src/integrations/instagram/signature.ts`
- Create: `src/integrations/instagram/webhook-types.ts`
- Create: `src/integrations/instagram/webhook-service.ts`
- Create: `src/integrations/instagram/meta-client.ts`
- Create: `src/integrations/instagram/send-policy.ts`
- Create: `src/app/api/webhooks/instagram/route.ts`
- Test: `src/integrations/instagram/webhook-service.test.ts`
- Test: `src/integrations/instagram/send-policy.test.ts`
- Test: `src/integrations/instagram/meta-client.test.ts`

**Interfaces:**
- Consumes: raw webhook bytes, signature header, Meta credentials, `AppDatabase`, and `ApiSendCommand`.
- Produces: `verifyMetaSignature`, `processInstagramWebhook`, `evaluateApiSend`, and `sendInstagramMessage`.

- [ ] **Step 1: Write failing signature, idempotency, handoff, and expiry tests**

```ts
it("rejects a webhook with an invalid sha256 signature", async () => {
  await expect(processInstagramWebhook(deps(), fixture.rawBody, "sha256=bad"))
    .rejects.toThrow("Invalid Meta webhook signature");
});

it("processes a redelivered inbound event exactly once", async () => {
  await processSignedFixture(db, "inbound-1");
  await processSignedFixture(db, "inbound-1");
  expect(countInboundMessages(db, "inbound-1")).toBe(1);
  expect(countJobs(db, "interpret:inbound-1")).toBe(1);
});

it("atomically transfers ownership from browser to API on reply", async () => {
  const result = await processSignedFixture(db, "inbound-2");
  expect(result.handoff).toBe("browser_to_api");
  expect(readLead(db, result.leadId).channelState).toBe("api_eligible");
  expect(readConversation(db, result.leadId).owner).toBe("api");
});

it("blocks an API send after the messaging window expires", () => {
  const decision = evaluateApiSend(apiContext({ lastInboundAt: hoursAgo(25) }));
  expect(decision).toEqual({ allowed: false, reason: "api_window_closed" });
});
```

- [ ] **Step 2: Run Instagram integration tests and confirm RED**

Run: `corepack pnpm vitest run src/integrations/instagram`

Expected: FAIL because signature, webhook, handoff, and API modules do not exist.

- [ ] **Step 3: Implement raw-body HMAC verification and idempotent webhook processing**

```ts
export function verifyMetaSignature(rawBody: Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);
  return received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
```

Process external event insertion, inbound message insertion, state transitions, ownership handoff, audit event, and interpretation-job enqueue in one transaction. Treat a unique-event conflict as a successful no-op.

- [ ] **Step 4: Implement the API eligibility policy and mode-aware Meta client**

```ts
export function evaluateApiSend(context: ApiSendContext): ApiSendDecision {
  if (context.doNotContact) return deny("do_not_contact");
  if (context.channelOwner !== "api") return deny("channel_not_owned_by_api");
  if (!context.recipientId) return deny("missing_recipient_id");
  if (!context.lastInboundAt || differenceInHours(context.now, context.lastInboundAt) >= 24) return deny("api_window_closed");
  if (!context.integrationHealthy) return deny("instagram_unavailable");
  return { allowed: true };
}
```

The live client posts to `https://graph.instagram.com/{version}/{businessAccountId}/messages` with a Bearer token; simulated mode returns a stable fake message ID; dry-run records the request without network access. Persist the outbound idempotency key before considering a send successful.

- [ ] **Step 5: Run webhook and API tests**

Run: `corepack pnpm vitest run src/integrations/instagram`

Expected: signature verification, verification challenge, redelivery, unmatched lead, handoff, expiry, dry-run, and duplicate-send tests PASS.

- [ ] **Step 6: Commit Meta integration**

```powershell
git add src/integrations/instagram src/app/api/webhooks/instagram
git commit -m "feat: hand off replies to official Meta API"
```

### Task 8: OpenAI Conversation Decisions, Claims Policy, and Budget Cutoff

**Files:**
- Create: `src/integrations/openai/decision-schema.ts`
- Create: `src/integrations/openai/prompt.ts`
- Create: `src/integrations/openai/claims-policy.ts`
- Create: `src/integrations/openai/budget.ts`
- Create: `src/integrations/openai/client.ts`
- Create: `src/features/conversations/conversation-service.ts`
- Test: `src/integrations/openai/claims-policy.test.ts`
- Test: `src/integrations/openai/budget.test.ts`
- Test: `src/features/conversations/conversation-service.test.ts`

**Interfaces:**
- Consumes: `BusinessConfig`, public profile context, full conversation history, experiment assignment, `AppDatabase`, and exact model IDs.
- Produces: `decideNextAction`, `enforceClaimsPolicy`, `assertAiBudgetAvailable`, `recordAiCall`, and `handleInboundConversation`.

- [ ] **Step 1: Write failing claims, opt-out, schema, and budget tests**

```ts
it("rejects an outbound response containing an unverified health claim", () => {
  const result = enforceClaimsPolicy("Este produto cura doenças.", businessConfig());
  expect(result).toEqual({ allowed: false, reason: "unverified_claim" });
});

it("blocks a made-up affiliate destination", () => {
  const result = enforceClaimsPolicy("Entre em https://example.com/grupo", businessConfig({ affiliateGroupLink: null }));
  expect(result).toEqual({ allowed: false, reason: "unconfigured_link" });
});

it("handles opt-out without calling a model", async () => {
  await handleInboundConversation(deps(), inbound("pare de mandar mensagem"));
  expect(fakeOpenAi.calls).toHaveLength(0);
  expect(readLead(db, lead.id).channelState).toBe("do_not_contact");
});

it("pauses AI work before a call that exceeds the monthly budget", () => {
  seedAiCost(db, 10);
  expect(() => assertAiBudgetAvailable(db, 10)).toThrow("openai_budget_exhausted");
  expect(readSystemPause(db, "ai")).toBe(true);
});
```

- [ ] **Step 2: Run conversation tests and confirm RED**

Run: `corepack pnpm vitest run src/integrations/openai src/features/conversations`

Expected: FAIL because decision, claims, budget, and conversation modules do not exist.

- [ ] **Step 3: Define and parse the strict decision schema**

```ts
export const conversationDecisionSchema = z.object({
  intent: z.enum(["interested", "asked_info", "asked_pricing", "wants_whatsapp", "not_the_owner", "will_forward", "objection", "not_interested", "opt_out", "ambiguous", "needs_human"]),
  action: z.enum(["respond", "ask", "introduce", "handle_objection", "handoff_whatsapp", "wait", "schedule_follow_up", "close", "escalate_human"]),
  responseText: z.string().max(1000).nullable(),
  confidence: z.number().min(0).max(1),
  reasoningSummary: z.string().max(500),
  followUpAt: z.string().datetime().nullable(),
  escalationReason: z.string().max(500).nullable()
});
```

- [ ] **Step 4: Implement deterministic policy gates and the SDK adapter**

The prompt lists verified claims as the exclusive assertion set and unverified claims as forbidden. `enforceClaimsPolicy` normalizes accents and whitespace, rejects denylisted phrases, detects URLs not equal to configured destinations or the company website, rejects unsupported currency/percentage/quantity claims, and returns a typed reason. The OpenAI adapter uses the Responses API with structured JSON output and records model, input/output tokens, estimated cost, purpose, and lead ID.

- [ ] **Step 5: Implement conversation orchestration**

Run deterministic opt-out detection first. Then check budget, call the fast model for intent when needed, call the main model for response decisions, parse strict output, enforce claims and channel policy, record the decision, and enqueue either API send, follow-up evaluation, close, or human exception. A rejected message becomes `human_review_required` and is never auto-rewritten.

- [ ] **Step 6: Run OpenAI and conversation tests**

Run: `corepack pnpm vitest run src/integrations/openai src/features/conversations`

Expected: schema rejection, verified claim, unverified claim, invented link, opt-out, budget cutoff, usage recording, and action routing tests PASS.

- [ ] **Step 7: Commit the conversation engine**

```powershell
git add src/integrations/openai src/features/conversations
git commit -m "feat: add policy-bound conversation decisions"
```

### Task 9: Funnel Orchestration, Campaigns, Follow-ups, and WhatsApp Handoff

**Files:**
- Create: `src/features/campaigns/campaign-service.ts`
- Create: `src/features/campaigns/follow-up.ts`
- Create: `src/features/affiliates/affiliate-service.ts`
- Create: `src/integrations/whatsapp/handoff.ts`
- Create: `src/worker/handlers.ts`
- Test: `src/features/campaigns/follow-up.test.ts`
- Test: `src/features/affiliates/affiliate-service.test.ts`
- Test: `src/integrations/whatsapp/handoff.test.ts`
- Test: `src/worker/handlers.test.ts`

**Interfaces:**
- Consumes: all domain and integration services from Tasks 3–8.
- Produces: `createCampaign`, `evaluateFollowUp`, `recordAffiliateOutcome`, `resolveHandoff`, and the complete `JobHandlerMap`.

- [ ] **Step 1: Write failing orchestration and handoff tests**

```ts
it("does not send a browser follow-up before an inbound reply", () => {
  const decision = evaluateFollowUp(followUpContext({ channelState: "waiting_inbound_reply", lastInboundAt: null }));
  expect(decision).toEqual({ action: "close_without_send", reason: "no_inbound_reply" });
});

it("routes an interested customer to the configured WhatsApp link", () => {
  expect(resolveHandoff(businessConfig(), "customer")).toEqual({ kind: "link", url: configuredWhatsappLink() });
});

it("escalates an affiliate handoff while the group link is absent", () => {
  expect(resolveHandoff(businessConfig({ affiliateGroupLink: null }), "affiliate"))
    .toEqual({ kind: "human_review", reason: "affiliate_group_link_missing" });
});
```

- [ ] **Step 2: Run orchestration tests and confirm RED**

Run: `corepack pnpm vitest run src/features/campaigns src/features/affiliates src/integrations/whatsapp src/worker/handlers.test.ts`

Expected: FAIL because follow-up, affiliate, handoff, and handler modules do not exist.

- [ ] **Step 3: Implement guarded follow-ups and independent handoff resolution**

```ts
export function resolveHandoff(config: BusinessConfig, funnel: Funnel): HandoffDecision {
  if (funnel === "customer" && config.whatsappLink) return { kind: "link", url: config.whatsappLink };
  if (funnel === "affiliate" && config.affiliateGroupLink) return { kind: "link", url: config.affiliateGroupLink };
  return { kind: "human_review", reason: funnel === "customer" ? "whatsapp_link_missing" : "affiliate_group_link_missing" };
}
```

Follow-up evaluation cancels on no inbound reply, expired API window, opt-out, closed state, human review, block, or integration circuit. It never schedules browser fallback after handoff.

- [ ] **Step 4: Wire the typed durable job handlers**

Register concrete handlers for `qualify_lead`, `prepare_first_contact`, `send_browser_contact`, `interpret_inbound`, `send_api_response`, `evaluate_follow_up`, `measure_experiment`, `adapt_strategy`, `backup_database`, and `check_integrations`. Each handler validates its Zod payload, passes a correlation ID, and is idempotent on replay.

- [ ] **Step 5: Run orchestration tests**

Run: `corepack pnpm vitest run src/features src/integrations/whatsapp src/worker`

Expected: customer and affiliate state progression, safe follow-up, correct handoff, missing-link exception, job replay, and attribution tests PASS.

- [ ] **Step 6: Commit complete funnel orchestration**

```powershell
git add src/features/campaigns src/features/affiliates src/integrations/whatsapp src/worker
git commit -m "feat: orchestrate customer and affiliate funnels"
```

### Task 10: PT-BR CRM, Metrics, Alerts, and Operator Controls

**Files:**
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(dashboard)/page.tsx`
- Create: `src/app/(dashboard)/clientes/page.tsx`
- Create: `src/app/(dashboard)/afiliados/page.tsx`
- Create: `src/app/(dashboard)/leads/[id]/page.tsx`
- Create: `src/app/(dashboard)/operacao/page.tsx`
- Create: `src/app/(dashboard)/experimentos/page.tsx`
- Create: `src/app/(dashboard)/configuracoes/page.tsx`
- Create: `src/app/actions.ts`
- Create: `src/features/dashboard/queries.ts`
- Create: `src/features/dashboard/formatters.ts`
- Create: `src/features/dashboard/components/sidebar.tsx`
- Create: `src/features/dashboard/components/stat-card.tsx`
- Create: `src/features/dashboard/components/funnel-board.tsx`
- Create: `src/features/dashboard/components/status-badge.tsx`
- Create: `src/features/dashboard/components/timeline.tsx`
- Create: `src/features/dashboard/components/operator-controls.tsx`
- Test: `src/features/dashboard/queries.test.ts`
- Test: `src/features/dashboard/formatters.test.ts`
- Test: `src/app/actions.test.ts`

**Interfaces:**
- Consumes: database query services and business config with secrets excluded.
- Produces: PT-BR server-rendered operational pages, `getDashboardSnapshot`, `getFunnelBoard`, `getLeadTimeline`, `setGeneralPause`, and `retryDeadLetterJob`.

- [ ] **Step 1: Write failing metrics and mutation tests**

```ts
it("calculates AI cost per lead and active customer", () => {
  seedDashboardCosts(db, { totalUsd: 12, leads: 6, activeCustomers: 2 });
  expect(getCostMetrics(db)).toEqual({ totalUsd: 12, perLeadUsd: 2, perActiveCustomerUsd: 6 });
});

it("returns translated labels for every internal status", () => {
  for (const state of allInternalStates) expect(formatStatus(state)).not.toBe(state);
});

it("records an audited general pause from the operator action", async () => {
  await setGeneralPause({ paused: true, reason: "Pausa operacional" });
  expect(readGeneralPause(db)).toBe(true);
  expect(lastAuditLog(db).reason).toBe("Pausa operacional");
});
```

- [ ] **Step 2: Run dashboard tests and confirm RED**

Run: `corepack pnpm vitest run src/features/dashboard src/app/actions.test.ts`

Expected: FAIL because dashboard queries, formatters, and actions do not exist.

- [ ] **Step 3: Implement server-only dashboard queries and audited actions**

Build exact aggregates for funnel counts, response and downstream conversion, overdue follow-ups, queue state, open exceptions, integration alerts, AI costs, experiments, and active-customer attribution. Server Actions validate form input, mutate in a transaction, append an audit log, and revalidate the affected route.

- [ ] **Step 4: Build the responsive PT-BR operations UI**

Use a restrained warm lemon/ink visual system, semantic CSS variables, high contrast, responsive grid, visible keyboard focus, real tables on wide screens, stacked records on narrow screens, and accessible labels. All empty states, dates, currency, counts, buttons, navigation, alerts, and validation copy are PT-BR. Render separate customer and affiliate Kanban boards, timeline, jobs, exceptions, experiments, costs, health cards, pause control, and configured channel shortcuts.

- [ ] **Step 5: Run dashboard tests, lint, and typecheck**

Run: `corepack pnpm vitest run src/features/dashboard src/app/actions.test.ts && corepack pnpm lint && corepack pnpm typecheck`

Expected: dashboard tests, ESLint, and TypeScript PASS with no operator-facing English found by the translation fixture test.

- [ ] **Step 6: Commit the operator dashboard**

```powershell
git add src/app src/features/dashboard
git commit -m "feat: deliver PT-BR prospecting operations dashboard"
```

### Task 11: Complete Simulated End-to-end Evidence and Operator Documentation

**Files:**
- Create: `src/test/fixtures/business.json`
- Create: `src/test/fixtures/instagram-webhook.json`
- Create: `src/test/e2e/simulated-cycle.test.ts`
- Create: `scripts/seed-demo.ts`
- Create: `scripts/run-evidence.ts`
- Create: `scripts/restore-backup.ts`
- Create: `SETUP.md`
- Create: `README.md`
- Test: `src/test/e2e/simulated-cycle.test.ts`

**Interfaces:**
- Consumes: the complete application services and fake integration clients.
- Produces: a deterministic evidence report with correlation IDs and invariant checks, plus Portuguese operator setup and English developer documentation.

- [ ] **Step 1: Write the failing end-to-end scenario**

```ts
it("runs both funnels through contact, inbound handoff, decision, outcome, adaptation, and restart recovery", async () => {
  const system = await createSimulatedSystem();
  const seeded = await system.seedTwoFunnelsWithDuplicate();
  await system.runUntilIdle();
  expect(seeded.uniqueLeads).toBe(2);
  expect(system.messagesByChannel("browser")).toHaveLength(2);

  await system.deliverSignedInboundReplies();
  await system.runUntilIdle();
  expect(system.duplicateOutboundCount()).toBe(0);
  expect(system.customerHandoff()).toBe("whatsapp_handoff");
  expect(system.affiliateException()).toBe("affiliate_group_link_missing");

  await system.recordDownstreamOutcomesAndAdapt();
  expect(system.experimentAudit().rollbackAllocation).toBeDefined();

  await system.simulateInterruptedJobAndRestart();
  expect(system.recoveredJobRuns()).toBe(1);
  expect(system.invariants()).toEqual({ duplicateLeads: 0, duplicateMessages: 0, orphanEvents: 0 });
});
```

- [ ] **Step 2: Run the scenario and confirm RED**

Run: `corepack pnpm vitest run src/test/e2e/simulated-cycle.test.ts`

Expected: FAIL because the simulated system harness and evidence scripts do not exist.

- [ ] **Step 3: Implement deterministic seed and evidence scripts**

`run-evidence.ts` creates a fresh temporary database, migrates it, loads only fixture placeholder data, runs both funnels, signs webhook fixtures with a fixture secret, executes the worker to idle, simulates outcomes and restart, performs a verified backup, and prints one JSON report containing `runId`, lead IDs, message IDs, handoff states, experiment change, recovered job ID, backup integrity, and invariant counts. It exits non-zero when any invariant fails.

- [ ] **Step 4: Write operator and developer documentation**

`SETUP.md` documents restricted OpenAI key creation, account hard limits, `.env` and business configuration, dedicated Chrome commands for Windows/macOS/Linux using `127.0.0.1`, the warning that CDP controls the logged-in session, one-time Instagram login, Meta app/webhook setup, start/pause, simulation, dry-run, live authorization, backup/restore, link updates, and leaked-secret rotation. `README.md` documents architecture, commands, module boundaries, tests, and evidence in English.

- [ ] **Step 5: Run E2E evidence and restore verification**

Run: `corepack pnpm evidence && corepack pnpm vitest run src/test/e2e/simulated-cycle.test.ts`

Expected: JSON report contains two unique leads, zero duplicate sends, browser-to-API handoff, customer WhatsApp handoff, affiliate missing-link exception, experiment adaptation, one recovered job, and backup integrity `ok`; E2E test PASS.

- [ ] **Step 6: Commit evidence and documentation**

```powershell
git add src/test scripts SETUP.md README.md
git commit -m "test: prove autonomous simulated prospecting cycle"
```

### Task 12: Final Hardening and Production Verification

**Files:**
- Modify: files implicated by verification failures only.
- Create: `docs/evidence/verification.md`
- Test: full repository.

**Interfaces:**
- Consumes: every executable command and acceptance invariant from Tasks 1–11.
- Produces: a clean verification record tied to the final commit.

- [ ] **Step 1: Run the complete quality gate**

Run: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build && corepack pnpm evidence`

Expected: every command exits 0; production build succeeds; evidence JSON reports all invariants satisfied.

- [ ] **Step 2: Run security and isolation scans**

Run: `git ls-files | rg "(^|/)(\.env|business\.json|.*\.db)$"; rg "bringToFront|chromium\.launch|launchPersistentContext|instagram-private-api|0\.0\.0\.0.*remote-debugging" src SETUP.md`

Expected: first command returns no tracked secret/business/database files; second returns no forbidden implementation usage and only the explicit `0.0.0.0` warning in operator documentation.

- [ ] **Step 3: Verify the production server smoke path**

Run: `corepack pnpm start`

Expected: web and worker start from one command, dashboard responds locally, worker reports healthy SQLite polling, and stopping the parent command stops both processes.

- [ ] **Step 4: Record exact evidence without claiming unavailable live proof**

```ts
const markdown = `# Verification Evidence

- Lint: passed at ${evidence.completedAt}
- Type check: passed
- Tests: ${evidence.passedTests} passed
- Production build: passed
- Simulated E2E run: ${evidence.runId}
- Duplicate leads: ${evidence.invariants.duplicateLeads}
- Duplicate outbound messages: ${evidence.invariants.duplicateMessages}
- Backup integrity: ${evidence.backupIntegrity}
- Real CDP dry-run: pending operator Chrome session
- Real live smoke: blocked until explicit operator authorization
`;
```

The verification script writes values captured from the same fresh quality-gate run.

- [ ] **Step 5: Commit final verified state**

```powershell
git add docs/evidence/verification.md
git commit -m "chore: record verified production readiness"
```
