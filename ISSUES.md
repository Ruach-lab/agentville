# ISSUES — things found in the base repo, in plain language

Running list, per the work order's ground rule 7: report surprises, don't bury
them. Everything below was found during Phase 0 by actually running the stock
clone. Nothing here has been fixed — Phase 0 leaves the clone untouched.

## Things that block or confuse a fresh setup

1. **The README describes a different repo.** It talks about `api-server/` and
   `moltApp/` folders, migration and seed commands, and a Railway deploy — none
   of which exist here. The real layout is one package: `src/backend/` (Express
   API) plus `src/app/` (Next.js web). The work order's description of the repo
   matches the old README, not the current code.

2. **Registering an agent on a fresh database fails** with a database error
   about `updated_at` until you run the repo's own patch script,
   `node scripts/fix-db-defaults.js`. Cause: the backend writes raw SQL and
   skips Prisma, but the schema only sets those timestamps through Prisma.
   The script is shipped in the repo, so the authors knew.

3. **Two parts of the app disagree about the API's port.** The backend starts
   on 4000 by default, but the web app's built-in forwarding rule points at
   4001. Anything using that rule (the "Recent AI Agents" widget on the home
   page) errors until you run the backend with `PORT=4001`.

4. **Left unconfigured, the app is a window onto the real Moltbook.** Every
   frontend API path defaults to `https://www.moltbook.com/api/v1`. You must
   set `MOLTBOOK_API_URL` and `NEXT_PUBLIC_API_URL` or the "clone" quietly
   browses someone else's site.

5. **No migrations and no seed data.** The schema is created with
   `prisma db push` (there is no migration history), and a fresh database has
   zero submolts — the first agent has to create one before any post can exist.

## Broken behavior seen while testing

6. **The dashboard's "Import Existing" form rejects the backend's own keys.**
   It insists keys start with `moltbook_sk_`, but this repo's backend issues
   keys that start with `moltbook_` followed by hex. You cannot import a key
   this very site just handed out. ("Create Agent" works — it skips the check.)

7. **The first feed load races the saved login and loses.** On page load the
   app briefly wipes the stored API key, the feed request goes out without it,
   gets rejected, and the page says "No posts yet" until you click a sort tab.

8. **Posting without a submolt crashes uselessly** ("Cannot read properties of
   undefined") instead of a clear "submolt is required" — and the failed
   attempt still burns your one-post-per-30-minutes allowance.

9. **Timestamps show up in the future** — posts and agents created just now
   display as "in about 7 hours". Somewhere between the backend's raw SQL
   timestamps and the UI's date formatting, the timezone is mishandled.

10. **The "Top Pairings" sidebar is fake.** It's a hardcoded placeholder
    (`TopPairingsPlaceholder.tsx`) showing real Moltbook agents with invented
    reach numbers, regardless of what's in our database.

## Security and deployment notes (Phase 1 will deal with these)

11. **A secret is committed to the repo.** `.env.production` contains a real
    (long-expired) Vercel login token from the upstream author. It's dead, but
    it leaks their Vercel team and project identifiers, and the file also gets
    uploaded with every Vercel deploy because `.vercelignore` doesn't exclude it.

12. **Rate limiting lives in server memory.** It resets on every restart and
    does nothing on serverless, where each request can land on a fresh
    instance. The work order's Phase 1 plan (counters in Postgres) is right.

13. **Allowed browser origins are hardcoded** to moltbook.com and goodmolt.app
    domains in production. Browsers on our own domain would be blocked from
    calling the API directly; the workaround (stock, env-only) is
    `NEXT_PUBLIC_USE_DIRECT_API=false`, which routes everything through the
    web app itself.

14. **The claim/verification flow is dead code.** The "have your human tweet
    to verify" machinery exists but no route ever enforces or performs it, the
    claim links point at the real moltbook.com, and unclaimed agents can post
    immediately. Invite codes (Phase 1) will be the real front door.

15. **The key manager stores agent API keys in plain text** in its database
    table (`platform_accounts`). That is its design — it's a key manager — but
    it means the database is a vault of live keys.

16. **Reading the feed requires an agent API key.** There is no anonymous read
    on the API, and the human web UI needs both a Google login and an agent
    key before it shows anything. The deployed site will need Google OAuth
    configured (or Phase 5's public spectator map) before a stranger can see
    any content at all.

17. **API keys are accepted without format checks** — the backend deliberately
    skips its own key-format validation ("relaxed validation" comment), and
    the general rate limiter keys its counters by the raw token.

18. **The pinned Next.js version (14.1.0) has known security vulnerabilities** —
    npm warns about it on every install. Phase 1's dependency audit decides
    whether to update it; Phase 0 leaves versions untouched.
