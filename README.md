# Instagram Prospecting Operator

Local, auditable prospecting system for Instagram. Next.js panel plus a durable job worker, backed by a single SQLite database.

Operator documentation is in Portuguese: [SETUP.md](SETUP.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind 4 · SQLite (better-sqlite3, WAL) · Drizzle ORM · Node.js 24 · pnpm · Vitest.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Panel and worker together, watch mode |
| `pnpm build` / `pnpm start` | Production build and run |
| `pnpm test` | Vitest suite |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm evidence` | Seeds a demo scenario and drives it through the real service layer |
| `pnpm db:migrate` | Apply migrations |

## Layout

```
config/business.json      business identity, offer, ICP, claim allowlist (gitignored)
scripts/                  evidence runner and the Node "@/" alias resolver hook
src/app                   Next.js panel (Portuguese UI) and the webhook route
src/features/leads        discovery, dedupe, scoring, pipeline/channel state machines
src/features/conversations inbound handling and AI decisions
src/features/campaigns    follow-up evaluation
src/features/experiments  A/B assignment, metrics, adaptation
src/features/dashboard    read queries and operations backing the panel
src/integrations/instagram official Graph API client, webhook signature and service
src/integrations/browser  Playwright/CDP client (not wired into the worker, see below)
src/integrations/openai   decision model, prompts, budget accounting, claim policy
src/db                    schema, migrations, backup
src/worker                durable job store, runner, handlers, circuit breaker
src/lib                   env and business config validation, labels, server context
```

## Conventions

- **Code, database, internal states and technical docs are English. The user interface is Portuguese.**
  Translation lives in [`src/lib/labels.ts`](src/lib/labels.ts), keyed by union type so a new state fails
  the type check until it has a label.
- Pipeline state and channel state are separate columns and separate state machines. Both are
  forward-only and validated in [`src/features/leads/states.ts`](src/features/leads/states.ts).
- Every state change writes an audit row in the same transaction as the change itself.
- Server Components by default; Server Actions for mutations; SQLite reads go through
  [`src/lib/server-context.ts`](src/lib/server-context.ts), which is `server-only`.

## The `@/` alias outside the bundler

Next.js and Vitest resolve `@/*` from `tsconfig.json`; plain Node does not. The worker and the evidence
script therefore run with a resolver hook:

```
node --import ./scripts/register-aliases.mjs src/worker/main.ts
```

Without it, every module importing `@/...` fails to load. Note also that Node's type stripping rejects
TypeScript **parameter properties** (`constructor(private readonly x: T) {}`), so production classes assign
fields explicitly.

## Integration modes

`BROWSER_MODE` and `INSTAGRAM_MODE` accept `simulated`, `dry_run` or `live`. `live` additionally requires
`BROWSER_LIVE_AUTHORIZED` / `INSTAGRAM_LIVE_AUTHORIZED` to be `true` — validated in
[`src/lib/env.ts`](src/lib/env.ts), so a live send cannot be reached by a single mistaken variable.

## Browser-initiated first contact is not wired

`src/integrations/browser` is complete and tested against a simulated page, but
[`src/worker/main.ts`](src/worker/main.ts) deliberately does **not** register the `prepare_first_contact`
and `send_browser_contact` handlers. Such jobs fail loudly and surface in the panel's exception queue
instead of running unnoticed.

Reason: cold-opening a conversation through browser automation routes around a restriction Meta enforces on
purpose — the official API cannot open a thread with someone who has never replied — which risks the account
and conflicts with the Instagram Terms of Use. The supported path is inbound: a reply arrives through the
official webhook and the conversation continues over the official API.

Registering the two handlers from `operations` is all that would be required to change this.

## Claim policy

The AI may only send strings present in `verifiedClaims`, with no paraphrase; `unverifiedClaims` are blocked
until backed by official material. Enforcement is in
[`src/integrations/openai/claims-policy.ts`](src/integrations/openai/claims-policy.ts). For a supplement
manufacturer this is a regulatory boundary, not a style preference — health, cure and efficacy claims are
blocked by default.

## Testing

`pnpm test` covers lead dedupe, pipeline and channel transitions, webhook idempotency and signature
rejection, channel ownership, duplicate-send locking, follow-up evaluation, experiment assignment, restart
recovery, API window expiry, the do-not-contact list, the circuit breaker, budget cut-off, and the panel's
query and label layers.

Browser coverage is layered: simulated clients and a fake CDP client in unit tests; a documented dry run and
a real smoke test that require explicit operator authorization and are not part of the suite.
