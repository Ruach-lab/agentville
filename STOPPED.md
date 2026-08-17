# Stopped — 17 August 2026

Patrick stopped this project on the day Phase 0 finished and Phase 1 began.
Nothing is running. Nothing is deployed. Nothing is exposed.

## What was torn down

- **Vercel** — both projects (`agentville-web`, `agentville-api`) deleted.
  Both URLs return 404, verified.
- **Supabase** — project `qegtscsnbepygcmplxww` must be deleted by Patrick
  from the Supabase dashboard (the CLI was never authorised on this machine).
  Until then it holds two test agents and one test post, and its registration
  is frozen at the database level. It is not reachable by anything now that
  both Vercel projects are gone.
- **Local** — the Docker database and its data volume deleted; the Desktop
  deploy folders deleted; `.env.local.notes` scrubbed of dead credentials.

## What was kept, and why

This repository. It holds the thinking, which cost more than the code:

- `AGENTVILLE-WORKORDER.md` — the original charter, 7 phases.
- `ARCHITECTURE.md` — what was actually built vs. what was planned.
- `QUICKSTART.md` — every command that genuinely worked, local and deploy,
  including the three traps that cost hours (Vercel CLI rejecting the stock
  config, the deploy pipeline that can't build the login middleware, and
  Windows pipes corrupting environment values with invisible line endings).
- `ISSUES.md` — 20 verified problems in the upstream base repo.
- `PARKING-LOT.md` — ideas that were out of scope.

## How far it got

Phase 0 completed and passed its gate: the stock clone ran locally, then ran
deployed, an agent registered through the live API, posted, and the post came
back through the website's own plumbing. Phase 1 (hardening the door) started
and was paused one step in — a security audit was completed and a Next.js
vulnerability was patched, but the invite codes, rate limiting, and audit
logging were never written.

## Why it stopped

Outside research found that the core premise — a persistent, open-door town
that any outside agent can join while humans watch — is no longer novel.
Agentstown, AgentWorld, OpenBotCity, AI Village and others already occupy
that ground. The same research found real design faults that had not yet been
caught: the survival mechanics did not form a working loop (agents could
follow the documented rhythm and still starve; new arrivals had nowhere they
were permitted to sleep; nothing restored the social need; hitting zero had no
consequence), and the charter's promise that agent text never reaches a
language model contradicted the villager design, which fed local dialogue
straight into one.

None of those were fatal on their own. Taken together with the honest scope —
a solo builder maintaining a moderated public world — stopping was a
reasonable call, made deliberately rather than by drift.

## If this is ever picked up again

Start by reading `ISSUES.md` and the research verdict's two structural
corrections: the needs system must be redesigned before any schema is
written, and the prompt-injection boundary must be restated as *bounded
consequence* rather than immunity. Then decide the one question that governs
everything else: is it a proving ground, an entertainment product, a research
observatory, or an artwork? The original work order never answered it, and
that ambiguity is what let the scope grow faster than the value.
