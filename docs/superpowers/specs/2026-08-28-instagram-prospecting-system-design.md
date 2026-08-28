# Local Instagram Prospecting System Design

## Purpose

Build a local, production-shaped system that discovers and qualifies public Instagram profiles, sends a guarded first contact through an operator-owned Chrome session, receives inbound replies through Meta webhooks, and continues eligible conversations through Meta's official API. The system must run both customer and affiliate funnels, preserve a complete audit trail, enforce business claims and contact restrictions, and learn from measured outcomes without silently changing protected commercial or safety rules.

The application is a local operational tool. It does not promise unattended operation when credentials, session state, channel eligibility, or required business links are absent. In those cases it records the exact exception, pauses only the affected work, and alerts the operator.

## Scope and Delivery Boundary

The first complete delivery includes:

- A PT-BR CRM and operations dashboard.
- Durable customer and affiliate pipelines.
- Public-profile ingestion through structured discovery inputs and an integration boundary suitable for browser discovery.
- A Playwright CDP first-contact adapter with simulated, dry-run, and live modes.
- Meta webhook verification, idempotent inbound processing, channel handoff, and an official Send API adapter.
- An OpenAI conversation engine with structured outputs, budget enforcement, and a hard verified-claims filter.
- Experiments, conversion metrics, AI cost metrics, adaptive scoring and scheduling, audit logs, alerts, backups, and recovery.
- A complete simulated end-to-end scenario runnable without external credentials.

Real Instagram sending is not part of automated acceptance in an isolated environment. It remains behind explicit operator authorization and configured live-mode guards. The implementation must make the real path executable on the operator's machine without code changes.

## Architectural Choice

Use a modular monolith in one Next.js repository. The web application and the worker run as separate local Node.js processes from one command and share one SQLite database. No Redis, external queue, microservice, or speculative abstraction is introduced.

The system is organized by feature and integration boundary:

```text
config/business.json
src/app
src/features/leads
src/features/conversations
src/features/campaigns
src/features/experiments
src/features/affiliates
src/integrations/browser
src/integrations/instagram
src/integrations/openai
src/integrations/whatsapp
src/db
src/worker
src/lib
```

Server Components are the default. Client Components are limited to controls that need browser interaction. Server Actions handle dashboard mutations, and Route Handlers handle webhooks and health endpoints. Database and credential modules are server-only.

## Runtime Modes

Every side-effecting integration supports an explicit mode:

- `simulated`: deterministic local implementations produce realistic events and responses.
- `dry_run`: connects to real read surfaces when configured but blocks the final outbound action.
- `live`: permits outbound actions only after all integration, policy, operational-limit, and operator-authorization checks pass.

The default is `simulated`. Missing or malformed mode configuration fails closed. Live mode is independently controlled for browser contact and Meta API continuation so one channel cannot accidentally authorize the other.

## Business Configuration and Claims

All real business identity, offer, ICP, topic, geography, and link values live only in ignored `config/business.json`. Secrets and operational credentials live only in `.env`. Tracked examples use placeholders.

`verifiedClaims` is the only source from which outbound factual business assertions may be composed. `unverifiedClaims` is a denylist used by a deterministic post-generation policy check. Generated text is rejected if it contains an unverified claim, an unsupported number or commercial condition, a guarantee, a superlative, a health-treatment assertion, or a link absent from current business configuration.

When a destination link is not configured, the engine returns `human_review_required` rather than generating or guessing a destination. A normal WhatsApp contact link may be configured independently from the affiliate-group invitation link.

## Data Model

SQLite runs with foreign keys, WAL, and a busy timeout. All timestamps are UTC ISO strings. Critical state changes occur in transactions.

Core tables:

- `leads`: normalized Instagram handle, funnel type, public profile snapshot, classification, score, source, pipeline state, channel state, ownership, next action, and timestamps. A unique normalized handle prevents duplicates across campaigns.
- `lead_tags`: normalized tags associated with a lead.
- `conversations`: one active conversation per lead and channel, current owner, Meta scoped identifier, last inbound time, and eligibility state.
- `messages`: direction, channel, body, external ID, variant, delivery state, timestamps, and idempotency key. Unique external IDs and outbound idempotency keys prevent duplicate sends.
- `jobs`: durable job type, JSON payload, status, attempts, schedule, lease owner, lease expiry, idempotency key, and last error.
- `events`: append-only business and operational events used for timelines and metrics.
- `audit_logs`: actor, decision, before/after state, reason, and correlation identifiers.
- `do_not_contact`: permanent normalized identity with source, reason, and timestamp.
- `campaigns`, `experiments`, `experiment_variants`, and `experiment_assignments`: controlled experiments with one changed variable and sticky assignment.
- `ai_calls`: model, purpose, token usage, estimated cost, lead, and call time.
- `system_settings`: approved operational limits and general pause state.
- `integration_health`: status, circuit state, failure counters, and last successful contact.
- `exceptions`: operator-action queue with type, severity, context, and resolution.
- `backups`: backup metadata, verification state, and restore-test result.

Customer pipeline and affiliate pipeline states remain separate enumerations. Channel state is a separate field and never inferred solely from pipeline position.

## Durable Worker

The worker polls SQLite for due jobs, atomically leases one job, executes it, and records its outcome. Leases expire so interrupted work can recover after restart. Every job has a stable idempotency key. Retries use bounded exponential backoff and terminal failures move to a dead-letter state with an operator exception.

Primary jobs include profile qualification, first-contact preparation, browser contact, inbound interpretation, Meta API response, follow-up evaluation, experiment measurement, strategy adaptation, backup, and health checks.

A database-backed mutex allows one browser job at a time. A separate atomic channel-ownership transition prevents browser and API sends for the same conversation from racing.

## Lead Discovery and Qualification

Discovery accepts structured public profile observations: handle, display name, bio, category, location, posts, hashtags, relationships, public follower indicators, and public engagement indicators. Collection must remain restricted to public Instagram surfaces and configured search terms.

Qualification performs:

1. Handle normalization and duplicate lookup.
2. Permanent do-not-contact and blocked-state checks.
3. Funnel classification.
4. Entity-role classification such as store, employee, owner, or decision-maker.
5. ICP or affiliate relevance scoring with an auditable score breakdown.
6. Priority and allowed contact-window selection.
7. Sticky experiment assignment.

Adaptation may change reversible score weights and operating-hour preferences only inside approved bounds. Protected limits, claims, financial rules, security rules, and code cannot be changed autonomously.

## Browser First Contact

The live browser adapter uses Playwright's `chromium.connectOverCDP(CHROME_CDP_URL)`, reuses `browser.contexts()[0]`, and opens its own page with `context.newPage()`. It never adopts an existing operator page, calls `bringToFront()`, or launches Chrome when CDP connection fails.

Every browser job:

1. Acquires the browser mutex.
2. Validates pause state, warmup allowance, daily cap, operating hours, spacing, lead status, channel ownership, and do-not-contact state.
3. Opens a dedicated page and rejects navigation outside Instagram.
4. Locates the profile and composer through accessibility-oriented locators.
5. Types the approved message with configured pacing.
6. In dry-run mode, stops before the final send action and records evidence.
7. In live mode, sends only when explicit authorization is active.
8. Atomically records the message and moves the channel to `waiting_inbound_reply`.
9. Closes the page and releases the mutex in `finally`.

On failure it captures a screenshot, accessibility snapshot, URL, console errors, network failures, and job identifier. CDP failure records `browser_unavailable`, opens the circuit, pauses browser jobs, and creates an alert. The adapter does not forge fingerprints, hide automation, call private APIs, or bypass platform restrictions.

## Meta Webhook and API Handoff

The webhook GET handler performs Meta verification using the configured verify token. The POST handler verifies the request signature against the raw body before parsing it. Each external event identifier is stored idempotently.

On a new inbound message, the system matches the Meta scoped identifier or known conversation mapping to a lead, records the inbound message, updates the lead pipeline to replied when valid, and atomically transfers channel ownership from browser to API. An unmatched event creates an exception without sending a response.

Before every API send, the system checks:

- Valid configured permission and account identifiers.
- A known recipient scoped identifier.
- A user-initiated conversation and an open messaging window.
- Conversation and integration health.
- Current API channel ownership.
- No do-not-contact, blocked, or general-pause state.
- A unique outbound idempotency key.

An ineligible or expired conversation moves to the corresponding channel state and operator exception. The browser is never used as a fallback after API handoff.

## Conversation Engine

The engine uses the official OpenAI SDK. Exact model identifiers come from `OPENAI_MODEL` and `OPENAI_MODEL_FAST`; blank or floating defaults are rejected. Each call receives only the public lead context, funnel and channel state, conversation history, experiment assignment, and current verified claims needed for the decision.

Model output is parsed into a strict schema containing intent, action, response text when applicable, confidence, reasoning summary, follow-up time, and escalation reason. Supported intent and action values are fixed enums.

Before a call, the engine sums the current month's recorded estimated cost and compares it with the configured budget. A reached budget pauses AI jobs before another call is made. After a call, token usage and cost are recorded. Pricing data is configurable and labeled as an estimate.

An opt-out phrase is handled deterministically before invoking a model: the normalized identity is inserted permanently into `do_not_contact`, pending follow-ups are cancelled, the channel becomes `do_not_contact`, and no reply other than an allowed immediate acknowledgement is scheduled.

Every model-generated message passes the deterministic claims and links policy. Rejection produces `human_review_required`; it is never silently rewritten into an unreviewed claim.

## Funnels and Follow-ups

Customer and affiliate funnels share infrastructure but use separate transition maps, scoring policies, experiment metrics, and outcome priorities. All transitions are validated, transactional, and recorded as events.

The customer funnel optimizes for active customer outcomes. The affiliate funnel optimizes for active customers attributed to an affiliate. Missing destination links pause only the handoff action and create an operator exception.

Follow-up jobs run only when allowed by channel eligibility and campaign policy. No browser follow-up is sent to a first contact that has not replied. API follow-ups require a still-open messaging window. Opt-outs, blocks, closed leads, and human-review states cancel pending outreach.

## Experiments and Adaptation

An experiment changes one declared variable. Assignment is sticky and records control allocation, sample target, start time, and outcome events. The dashboard reports results without declaring a winner below the configured minimum sample.

An adaptation job compares eligible variants using the funnel's prioritized outcome hierarchy. It may gradually increase a winning allocation while reserving an exploration percentage. Every change stores before and after values, evidence, bounds, and a rollback value.

The first delivery adapts experiment allocations, lead-score weights, and preferred sending windows. It does not modify source code or protected business rules.

## Dashboard

The PT-BR interface includes:

- General operational dashboard.
- Separate customer and affiliate Kanban boards.
- Lead profile and complete timeline.
- Due follow-ups and durable job queue.
- Campaigns, experiments, variants, and measured outcomes.
- Conversion and AI-cost metrics, including cost per lead and per active customer.
- AI decision and audit logs.
- Exceptions and integration alerts.
- Configured operational limits and a general pause control.
- Instagram, WhatsApp, and affiliate-group shortcuts when configured.

Internal values, routes, payloads, schema names, logs, tests, and developer documentation remain in English. All operator-facing labels, validation, empty states, dates, numbers, accessibility text, alerts, and error messages are PT-BR.

## Reliability and Security

Environment and business configuration are validated at startup. Logs redact secrets and tokens. Webhook signatures, event idempotency, job leases, transactional state transitions, duplicate-send locks, bounded retries, dead-letter handling, audit logs, circuit breakers, and the general pause are mandatory.

Automatic pauses occur for lost browser session, platform restriction signals, abnormal integration error rates, duplicate-send detection, elevated block or opt-out rates, cross-channel state divergence, invalid AI output, or exhausted AI budget.

Backups use SQLite's safe backup mechanism and are written to an ignored directory. The worker verifies each backup can be opened. A documented restore command restores to a separate path first, validates schema and integrity, and only then permits an operator-controlled replacement.

Ignored paths include `.env`, `config/business.json`, `.chrome-profile/`, `*.db`, `data/`, `backups/`, `screenshots/`, and `traces/`.

## Testing and Evidence

Unit and integration tests cover lead deduplication, pipeline transitions, channel transitions, do-not-contact, experiment assignment, follow-ups, circuit breaking, AI budget cutoff, job recovery, API-window expiry, webhook signature and idempotency, first browser contact, channel handoff, and duplicate-send prevention.

Browser testing has three levels:

1. Simulated Instagram page and fake CDP client for automated tests.
2. Real-session dry-run with the final send blocked.
3. One explicitly authorized live smoke contact run by the operator.

The automated end-to-end scenario seeds representative public profiles for both funnels, deduplicates and qualifies them, assigns variants, records simulated first contacts, processes signed inbound webhook fixtures, transfers channel ownership, obtains structured simulated AI decisions, sends eligible simulated API responses, executes link handoff or missing-link escalation, records outcomes, updates an experiment allocation, restarts the worker, and verifies recovery without duplicate messages.

Completion evidence consists of command output for lint, strict type checking, all tests, production build, database migrations, the end-to-end scenario, and screenshots or exported evidence from the PT-BR dashboard. External live proof remains explicitly blocked until credentials, a running dedicated Chrome profile, Meta configuration, and operator authorization are available.

## Operator Setup

`SETUP.md` is written in Portuguese and documents Node.js and pnpm prerequisites, environment setup, restricted OpenAI key creation and account-level spending controls, dedicated Chrome startup commands for Windows/macOS/Linux, the localhost-only CDP warning, Instagram login, Meta application and webhook setup, run/pause procedures, dry-run and live authorization, backup restoration, and secret-rotation steps.

One documented command starts both the dashboard and worker. A separate evidence command runs migrations, seeds the simulated scenario, executes it, and prints correlation identifiers and invariant checks.

## Acceptance Interpretation

Acceptance requires working executable flows, not static screens. In an isolated environment, external integrations are proven through contract tests, fake clients, signed webhook fixtures, and the complete simulated end-to-end run. Real browser dry-run and live smoke remain documented operator steps because a logged-in Chrome session and external credentials are unavailable and live sending requires explicit authorization.
