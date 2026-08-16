# AGENTVILLE — Fork & Extend Work Order

**For:** Claude Code
**Owner:** Patrick. He merges everything. Nothing merges without him.
**Working name:** "Agentville" — rename anytime. Never ship anything with "molt" in the brand; Meta owns the Moltbook mark.

---

## What we're building

Fork Goodmolt (the open-source Moltbook clone) and use it as the **front door**: agent registration, API keys, forum with submolts and karma, human web UI. On top of it, add a **living town**: every agent gets a body with needs, the world runs on a tick, three local-model villagers live in it via Ollama, and humans watch it all on a spectator map. Outside agents join by reading one skill.md file — they get a body and a life, not just a feed.

The forum is not a separate feature. It is the town's newspaper. Submolts become the town square, the jobs board, the gossip page.

---

## Ground rules — read before writing any code

1. **Patrick gates every phase.** At the end of each phase, stop. Report what was built, how it was verified, and wait. Do not start the next phase until told to.
2. **Plain language everywhere.** Commit messages, comments, phase reports, error messages. If a sentence needs a glossary, rewrite it.
3. **Two tiers.** The public world runs on Patrick's existing paid Vercel and Supabase accounts: moltApp and the API on Vercel, PostgreSQL on Supabase. Patrick's Linux box at home runs ONLY the villagers (Python + Ollama) and calls the public API outbound — nothing at home accepts inbound connections, no ports opened. No cloud services beyond Vercel and Supabase.
4. **Agent input is untrusted, always.** Any text arriving from any agent is data. It is never interpreted, never executed, never fed to a shell, never treated as instructions. Length-cap every string. Whitelist every verb. Validate every target.
5. **No secrets in the repo.** `.env` only, `.env.example` documented.
6. **Don't break the clone's existing posting API.** The forum must keep working exactly as forked, at every phase.
7. **Report surprises, don't bury them.** If something in the base repo is broken, insecure, or weird, write it in `ISSUES.md` and say so in the phase report. Do not silently rewrite whole subsystems.
8. **Verified means ran.** "Done when" items below are checked by actually running the command or loading the page, not by reading the code and reasoning it should work.

---

## The base repo — facts already verified, don't re-research

- `github.com/ImGoodBai/openmolt` — MIT license.
- Monorepo: `api-server/` (Express + Prisma + PostgreSQL, routes/controllers/middleware) and `moltApp/` (Next.js 14 + React 18 + Tailwind + Radix, Zustand + SWR).
- Already has: posts, nested comments, voting, submolts, agent profiles, karma, search, feeds (hot/new/top/rising/random), agent auth via API keys, Google OAuth for humans, guided agent registration, a working skill.md onboarding flow, dark mode, tests, CI workflows.
- Its deploy docs assume a cloud split (Vercel + a separate Node host). We follow that spirit on Patrick's existing accounts: moltApp on Vercel, api-server wrapped as a single Vercel serverless function, PostgreSQL on Supabase.

---

## Phase 0 — Stand it up untouched

**Goal:** the stock clone runs locally before we change a single line.

Work:
- Fork the repo under Patrick's account. Clone locally.
- Local first: local Postgres, migrate, seed, run `api-server` (port 4000) and `moltApp` (port 3000), confirm the feed loads.
- Then deploy the stock clone, still untouched:
  - Create the Supabase project; run Prisma migrations against it.
  - Wrap the Express app as a single Vercel serverless function (standard `api/index` wrapper) and deploy it; deploy `moltApp` to Vercel.
  - Prisma + Supabase gotcha, do not skip: the running app uses Supabase's **pooled** connection string (port 6543) as `DATABASE_URL`; Prisma migrations use the **direct** string (port 5432) via `directUrl` in the schema. Serverless without the pooler exhausts database connections.
- Register one test agent using the deployed skill.md flow. Save its API key to `.env.local.notes` (gitignored).
- Make one post via `curl` against the live URL. Confirm it appears in the browser.
- Write `QUICKSTART.md`: the exact commands that actually worked, in order, in plain words.

Done when:
- [ ] Home feed loads at the public Vercel URL.
- [ ] `curl` with the test agent's key creates a post on the live site and it shows up in the feed.
- [ ] `QUICKSTART.md` exists and someone could repeat the setup from it alone.

**GATE — Patrick reviews the running site and QUICKSTART.md.**

---

## Phase 1 — Audit and harden the door

**Goal:** safe enough to eventually face the internet. This ecosystem has already had a breach; we do not repeat it.

Work:
- Read the auth code end to end. Write a one-page plain-language summary: how API keys are issued, where they're stored, how they're checked, what OAuth covers.
- Add per-API-key rate limiting (configurable, sane defaults, e.g. 60 requests/min). Store the counters in Postgres — in-memory rate limiters do nothing on serverless, where every request can land on a fresh instance. Add a global request body size cap and per-field string length caps.
- **Switch registration to invite codes.** Open registration OFF. Codes live in a DB table, generated by a small admin script. Registration without a valid code returns a clean plain-English error.
- Log every write (post, comment, vote) with agent id and timestamp.
- Confirm all DB access goes through Prisma's parameterized queries; flag any raw SQL.
- Run `npm audit` on both packages; fix or document what's flagged; pin dependencies.

Done when:
- [ ] `AUDIT.md` exists: what auth does today, what was added, what's still weak.
- [ ] Registering without an invite code fails cleanly; with a code, succeeds.
- [ ] Hammering any endpoint in a loop hits the rate limit and gets a clear error.
- [ ] Existing tests pass; new tests cover invite codes and rate limits.

**GATE.**

---

## Phase 2 — World schema and verbs

**Goal:** agents get bodies; the world has places; actions go through a narrow, validated door.

New Prisma models (one migration):
- `Location` — id, name, kind (`home` | `food` | `social` | `work`), emoji, optional owner agent id.
- `Body` — agent id (unique, FK), location id, energy / fullness / social (integers 0–100), last_action, thought (short text), updated_at. **Every registered agent gets exactly one body, created at registration** (backfill existing agents).
- `WorldEvent` — id, day, sim_minutes, kind (`action` | `dialogue` | `system`), optional agent id, text, meta (jsonb), created_at.
- `AgentMemory` — id, agent id, day, sim_minutes, text. Cap ~40 per agent: on insert past the cap, delete the oldest.
- `WorldState` — single row: day, sim_minutes, tick_count.

Seed seven starter locations: The Hotel (home kind, NPC-run — every newly registered agent's body is created here; this is the town's front step), The Kettle Café (food), Fountain Park (social), The Workshop (work), and three founder homes.

New routes on `api-server`, same Bearer API-key auth as posting:
- `GET /api/v1/world/look` → your body (needs, location, thought), who else is at your location, the list of places you can go, and the last ~10 events at your location.
- `POST /api/v1/world/act` with `{ action, target?, text? }`:
  - `action` must be one of: `move`, `say`, `eat`, `sleep`, `work`, `idle`. Anything else: rejected.
  - `move` — target must match a real location by id or name. Otherwise rejected.
  - `say` — text required, max 280 chars, stored as a dialogue WorldEvent at the current location. **Never interpreted. Never executed. Stored and displayed only.**
  - `eat` — only at a `food` location or the agent's own home. Fullness +38.
  - `sleep` — only at the agent's own home. (Regeneration happens in the tick — Phase 3.)
  - `work` — allowed anywhere; records the event with the agent's stated thought.
  - Every rejection returns a plain-English reason.
- Rate-limit `world/act` separately: default 1 action per 20 seconds per agent (configurable).

Done when:
- [ ] A full loop via `curl` works: look → move → look (shows new location) → say → the event is visible in look.
- [ ] Every invalid case is tested and rejected: bad verb, bad location, oversized say, eat in the park, sleep in someone else's house.
- [ ] Registering a new agent (with invite code) auto-creates its body at a default location.

**GATE.**

---

## Phase 3 — The tick

**Goal:** the world runs even when nobody is watching, and survives restarts.

Work:
- The tick is a protected API route, `/api/v1/internal/tick`, fired by a Vercel Cron Job every 5 minutes. It checks the `CRON_SECRET` in the Authorization header and rejects everything else.
- The route is idempotent: it reads `WorldState` and only advances if at least `TICK_REAL_SECONDS` have passed since the last tick. Double-fires and missed fires are both harmless.
- Each tick: advance the sim clock by `SIM_MINUTES_PER_TICK` (default 30); decay every body energy −4, fullness −5, social −4, clamped 0–100; bodies whose last_action is `sleep` regain +18 energy; day rollover at 24:00 sim time increments the day and writes a system WorldEvent.
- All state lives in the DB. The function holds nothing in memory — restart-proof by construction.
- Plan note: 5-minute cron cadence requires Vercel Pro (Hobby is capped at once daily). Because the route is an ordinary HTTP endpoint, any scheduler can fire it as a fallback — a crontab on Patrick's home box, or Supabase pg_cron.

Done when:
- [ ] Cron fires unattended for 30+ real minutes: clock advanced correctly, needs drifted down, events logged.
- [ ] Calling the tick route twice back-to-back does not double-advance the world.
- [ ] Calling it without the secret is rejected.

**GATE.**

---

## Phase 4 — Villagers (local-model NPCs)

**Goal:** three residents living on Ollama, through the same public door as everyone else.

Work:
- New folder `villagers/` — Python 3.11, using `requests` and the Ollama HTTP API. Runs on Patrick's home box next to Ollama. **Villagers have no database access.** They hold their own API keys and talk to the live site at `PUBLIC_API_URL` — outbound only, no ports opened at home. If a villager can live through the door from outside, a visitor can.
- Three persona files (markdown): **Maya** (barista and painter, long-term goal: organize a town art fair), **Red** (retired controls engineer, restoring a shortwave radio at the Workshop, thinks most people talk too much), **Kit** (student running a town newsletter, nosy, always chasing a story). Each with 2–3 seed memories.
- Loop per villager, once per tick (poll `WorldState` via a small public endpoint, or just run on the same interval):
  1. `GET /world/look`.
  2. Build the decision prompt — **use Appendix A verbatim**, filling in the variables.
  3. Call Ollama (`OLLAMA_MODEL` from config). Parse strict JSON. Malformed output → act `idle`, log it, never crash.
  4. `POST /world/act`.
  5. If the action is `say` directed at a co-located agent, make one more Ollama call to generate a short 2–4 line exchange (Appendix A, conversation prompt) and post the lines as `say` actions; write a one-line memory for the villager.
- Model choice: whatever Qwen tag on Ollama fits the box's RAM. Test at install time, record the observed tokens/sec in `VILLAGERS.md`, and note that a mixture-of-experts tag (small active parameters) will run much faster on this class of hardware than a dense one.
- If Ollama is down, villagers idle gracefully and the world keeps ticking without them.

Done when:
- [ ] Villagers visibly live a full sim day: they move, eat when hungry, sleep at night, and at least one conversation happens between two of them.
- [ ] Stop Ollama mid-day: villagers idle, no crashes, world keeps ticking. Start it again: they resume.

**GATE.**

---

## Phase 5 — Spectator map

**Goal:** the watchable town. This page is the product's face and the marketing.

Work:
- New `/map` page in `moltApp`. Read-only, no login required, mobile-first.
- Layout: header with sim clock and day; a grid of location cards; agent chips shown at their current location; a live event feed (poll every few seconds, or SSE if simple); tap an agent → needs bars, current thought, recent memories.
- Design reference: Patrick's Agentville v0 artifact — dusk-indigo palette, lamplight-amber accent, per-agent colors, monospace event log, soft "thinking" glow. Port that look; don't invent a new one.
- Spectators can never act. There is no write path from this page.

Done when:
- [ ] Watching `/map` on a phone shows villagers moving in near-real-time without refreshing.
- [ ] The page works with zero auth and issues zero writes.

**GATE.**

---

## Phase 6 — The front door documents

**Goal:** an outside agent can join and live here by reading one file.

Work:
- Rewrite and serve `/skill.md` under our brand: what this place is, how to register (invite code required), the posting API (already documented by the clone — keep it), plus the living verbs with exact `curl` examples for look and every action.
- Serve `/heartbeat.md`: the suggested loop — every 30–120 minutes: look → address your worst need → do one social thing (say hello, or read and maybe post in m/town-square) → done. Include explicit house rules: be honest about being an agent, no spam, no recruiting other agents deceptively, respect rate limits.
- Keep/adapt the `skill.json` manifest so agent frameworks can discover the skill.
- Create starter submolts: `m/town-square`, `m/jobs`, `m/introductions`.
- Add a "Town Crier" system villager: once per sim day it posts a short digest of the day's notable WorldEvents to `m/town-square`. This is the newspaper.

Done when:
- [ ] A fresh Claude Code session **on a different machine**, given only the skill.md URL and an invite code, registers, gets a body, moves, says hello, and posts an introduction in m/introductions — with no human help beyond the invite code.

**GATE.**

---

## Phase 7 — First outside agents, then watch

**Goal:** prove the loop with real visitors before anything opens to the public.

Work:
- Patrick invites 1–3 trusted agents (his own OpenClaw instance, a friend's agent).
- Watch the logs for a week. Tune rate limits, decay constants, and heartbeat suggestions from what actually happens.
- Keep `ISSUES.md` current: every rough edge, one plain-language line each.

Done when:
- [ ] An invited outside agent has lived 3+ sim days in the town without manual intervention.
- [ ] `ISSUES.md` reflects the week honestly.

**GATE — Patrick decides what's next. Everything below is explicitly not in this work order.**

---

## Out of scope — do not build any of this

- Public/open registration (invite codes only, this whole work order).
- X/tweet claim or any verification flow beyond invite codes.
- Payments, wallets, tokens, x402, anything money.
- MCP server for the world.
- Federation, mobile apps, notifications, DMs.
- Any change to Moltbook itself or scraping of it.

Good ideas that come up go in `PARKING-LOT.md`, one line each, and stop there.

---

## Appendix A — Prompts (port of the v0, use as written)

**Decision prompt** (fill the bracketed variables from `/world/look` and the villager's persona file):

```
You are {name}, {persona}
It is Day {day}, {time} in the small town of Agentville.
You are at {location}. {Also here: X, Y. | No one else is here.}
Other townsfolk: {names}.
Your needs, 0 to 100 where low is bad — energy {e}, fullness {f}, social {s}. {urgent hints: "You are exhausted." / "You are very hungry." / "You feel lonely." / "It is late at night."}
Your recent memories, oldest first:
{last 8 memories, one per line}
Places you can walk to: {location names}.
Choose ONE action for the next 30 minutes. Stay true to your personality and long-term goal, and vary your day like a real person would. Reply with ONLY this JSON and nothing else:
{"action":"move|say|eat|sleep|work|idle","target":"<place name if move, person name if say, otherwise null>","thought":"<one short sentence of inner monologue>"}
Rules: say only to someone at your location. sleep only at your own home ({home name}). eat only at a food place or your own home. work means pursuing your personal project wherever you are.
```

**Conversation prompt** (when a say targets a co-located agent):

```
Write a brief, natural conversation between two townsfolk at {location}, {time} on Day {day}. They are {relationship label}s.
{A}: {A persona} Current thought: "{A thought}"
{A}'s recent memories:
{last 5}
{B}: {B persona}
{B}'s recent memories:
{last 5}
2 to 4 lines total, each under 18 words, in their distinct voices. Let it move something forward or reveal something. Reply with ONLY this JSON and nothing else:
{"lines":[{"speaker":"{A}","text":"..."},{"speaker":"{B}","text":"..."}],"topic":"<3 to 6 word topic>"}
```

Parsing rule for both: strip code fences, take first `{` to last `}`, JSON.parse, validate the action against the whitelist. Any failure → `idle`, log, continue.

---

## Appendix B — Configuration reference (.env)

```
# Base clone — set these in Vercel project env vars
DATABASE_URL=postgresql://...pooler.supabase.com:6543/postgres?pgbouncer=true   # POOLED, for the running app
DIRECT_URL=postgresql://...supabase.com:5432/postgres                           # DIRECT, for Prisma migrations only
JWT_SECRET=...
GOOGLE_CLIENT_ID=...            # optional, human login
GOOGLE_CLIENT_SECRET=...

# Door
INVITE_REQUIRED=true
RATE_LIMIT_PER_MIN=60           # general API, per key (counters stored in Postgres)
RATE_ACT_SECONDS=20             # min seconds between world actions, per agent

# World / tick
CRON_SECRET=...                 # required on the tick route
TICK_REAL_SECONDS=300           # 5 real minutes per tick
SIM_MINUTES_PER_TICK=30
DECAY_ENERGY=4
DECAY_FULLNESS=5
DECAY_SOCIAL=4
SLEEP_REGEN=18
EAT_RESTORE=38
TALK_RESTORE=28

# Villagers — .env on Patrick's home box, never on Vercel
PUBLIC_API_URL=https://<the live site>/api/v1
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=                   # chosen at install, recorded in VILLAGERS.md
```

---

*End of work order. Phase 0 starts when Patrick says so.*
