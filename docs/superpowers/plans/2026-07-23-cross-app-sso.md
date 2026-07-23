# Cross-application SSO implementation plan

> **For implementation:** Follow `superpowers:executing-plans` task by task. Keep each repository on its own `codex/cross-app-sso` branch and make a separate commit after its focused test suite passes.

**Goal:** Let every main-site user who is an administrator or has `accessGrantedAt` automatically enter the `xhstw`, `xiaoshou`, `sabc`, and `baokuangaixie` applications through a short-lived, single-use server-to-server SSO ticket.

**Architecture:** The main site owns authorization and the ticket. Each target app exchanges the ticket server-side using its own client secret, stores the returned main token only inside an encrypted HttpOnly cookie, and validates that token against the main site before serving protected traffic. The apps never share a database, browser cookie domain, or a target-side password list.

**Tech stack:** Next.js route handlers and middleware (main/xhstw/sabc/baokuangaixie), Vite/Fastify (xiaoshou), Prisma ticket storage (main), Node/Web Crypto, Node test/Vitest/tsx test runners.

---

## Shared protocol contract

- Products are exactly `xhstw`, `xiaoshou`, `sabc`, and `baokuangaixie`.
- The main site creates a ticket with the existing `video_sso_tickets` record, product binding, a 60-second expiry, and a single-use marker.
- A target callback accepts only `?ticket=...`, posts `{ ticket }` to its fixed main-site exchange endpoint with `x-qycm-sso-client-secret`, then sets a host-only `HttpOnly; Secure; SameSite=Lax` session cookie.
- `redirectPath` accepts only an internal absolute path (`/foo`, but not `//host`, `http:`, or another origin). Current entry flows use `/`.
- Before serving protected traffic, targets validate their stored main token through `GET {MAIN_APP_URL}/api/sso/session`; invalid or revoked sessions are cleared and restarted at the main site SSO start endpoint.

Required deployment values:

```dotenv
# Main qy-dianshangjiqiren service
SSO_XHSTW_CLIENT_SECRET=<random, shared only with xhstw>
SSO_XIAOSHOU_CLIENT_SECRET=<random, shared only with xiaoshou>
SSO_SABC_CLIENT_SECRET=<random, shared only with sabc>
SSO_BAOKUANGAIXIE_CLIENT_SECRET=<random, shared only with baokuangaixie>

# Each target, replacing <product>
MAIN_APP_URL=https://www.qycm.top
MAIN_APP_SSO_EXCHANGE_URL=https://www.qycm.top/api/external-sso/<product>/exchange
MAIN_APP_SSO_CLIENT_SECRET=<matching main-site product secret>
APP_SESSION_SECRET=<unique random secret for this target>
```

## Task 1: Main-site SSO registry and ticket exchange

**Repository:** `zxc9802/qy-dianshangjiqiren`  
**Files:**
- Create: `frontend/app/lib/external-sso.ts`
- Create: `frontend/app/api/external-sso/[product]/start/route.ts`
- Create: `frontend/app/api/external-sso/[product]/exchange/route.ts`
- Create: `frontend/tests/externalSso.test.mjs`

1. Write static and unit-style tests first for the product registry, 60-second expiry, redirect-path sanitising, required client secret, rejected user, ticket product mismatch, expiry, and one-time use.
2. Run the focused test; confirm it fails because the new modules/routes do not exist.
3. Implement a small product registry mapping keys to fixed HTTPS callback URLs and to only their matching server secret environment variable.
4. Build on the existing main authentication and `videoSsoTicket` helpers. `start` requires `getAuthUser`, retains the existing administrator-or-`accessGrantedAt` rule, creates a product-bound ticket, and returns the fixed callback URL with its ticket.
5. `exchange` requires JSON `{ ticket }` and a timing-safe product client-secret comparison. It atomically consumes only the matching, unexpired ticket and returns the minimal profile plus a signed short-lived main token.
6. Run `node --test frontend/tests/externalSso.test.mjs` and the existing relevant SSO tests. Then run the main frontend type/build check appropriate to the installed package scripts.
7. Commit only the Task 1 files: `feat: add external application SSO exchange`.

## Task 2: Main-site homepage uses the SSO start route

**Repository:** `zxc9802/qy-dianshangjiqiren`  
**Files:**
- Modify: `frontend/app/home2/page.tsx`
- Modify: `frontend/tests/xiaohongshuAutoGenerationEntry.test.mjs` or add a narrowly named homepage SSO test

1. Extend the current external-entry test first: each of the four named cards must carry its product key and initiate the matching `/api/external-sso/<product>/start` call rather than directly opening the public target URL.
2. Run the test and confirm the existing direct external-URL flow does not meet the new assertion.
3. Keep current login behavior, but when an authenticated user chooses an SSO product: call `start` with the existing bearer token, open only the server-returned callback URL, and handle a rejected request without opening the target directly.
4. Preserve any non-SSO external-link behavior and avoid adding a generic cross-origin redirect mechanism.
5. Run the focused homepage test plus the Task 1 tests and the production build.
6. Commit only Task 2 files: `feat: launch external apps through SSO`.

## Task 3: `xhstw` Next.js 15 SSO gate

**Repository:** `zxc9802/xhstw`  
**Files:**
- Create: `lib/main-app-sso.ts`
- Create: `app/api/sso/callback/route.ts`
- Create: `app/api/sso/session/route.ts`
- Modify: `middleware.ts`
- Modify: `app/login/page.tsx` if it still points to a local login route
- Create/modify: `tests/main-app-sso.test.ts`

1. Write tests first for callback success (cookie attributes and internal redirect), missing/failed ticket (no cookie), invalid cookie, and main-session rejection.
2. Run `npm test -- --test-name-pattern` or the repository’s focused tsx command; confirm it fails before the helper exists.
3. Implement a Web-Crypto-compatible encrypted session envelope using `APP_SESSION_SECRET`; keep the main token inaccessible to browser JavaScript.
4. Implement the callback with the fixed configured exchange endpoint and client secret. Reject missing user/token values and unsafe redirect paths.
5. In middleware, exempt Next assets and the callback endpoint; require a valid local envelope and a successful main `/api/sso/session` validation for all app pages/API. Failed validation clears the target cookie and redirects to the main-site SSO start path for `xhstw`.
6. Update the local login surface to start main-site SSO, not to authenticate locally.
7. Run the target’s focused test, full `npm test`, and `npm run build`.
8. Commit: `feat: protect xhstw with main-site SSO`.

## Task 4: `xiaoshou` Fastify and Vite SSO gate

**Repository:** `zxc9802/xiaoshou`  
**Files:**
- Create: `server/sso.ts`
- Modify: `server/index.ts` (or extract the Fastify builder if needed for injection tests)
- Modify: `server/**/*.test.ts`
- Modify: `src/services/analysisApi.ts`
- Modify: `package.json` and lockfile only if the existing dependencies lack a cookie parser

1. Write Fastify injection tests first for callback exchange/cookie/redirect, malformed ticket, missing session on `/api/v1`, and revoked main session clearing the cookie.
2. Run the focused test and confirm it fails before SSO hooks/routes exist.
3. Register cookie parsing and add the fixed callback endpoint. It exchanges only server-side, encrypts/signs a host-only HttpOnly cookie with `APP_SESSION_SECRET`, and never accepts caller-controlled identity headers.
4. Replace the current default `x-organization-id`, `x-user-id`, and `x-user-role` actor fallback for protected `/api/v1` routes with the validated SSO user. Preserve a public health route only if deployment monitoring requires it.
5. Change frontend API requests to send cookies (`credentials: 'include'`) and remove spoofable user identity headers.
6. Run the focused tests, `npm test`, `npm run typecheck`, and `npm run build`.
7. Commit: `feat: require main-site SSO in xiaoshou`.

## Task 5: `sabc` Next.js 16 SSO gate

**Repository:** `zxc9802/sabc`  
**Files:**
- Create: `lib/main-app-sso.ts`
- Create: `app/api/sso/callback/route.ts`
- Create: `app/api/sso/session/route.ts`
- Create: `middleware.ts`
- Create/modify: focused Vitest SSO test

1. Write the callback/session tests first: correct exchange writes only the secure target cookie; missing/failed ticket has no local login; invalid/revoked session is denied.
2. Run the focused Vitest command and confirm the missing helper/routes cause failure.
3. Reuse the same protocol, but use SABC’s own `APP_SESSION_SECRET` and cookie name. Do not migrate Dexie data or alter the assessment business API payloads.
4. Add middleware that leaves callback/static assets accessible while validating all app pages and API routes against the main session. It must clear stale cookies on failure and restart the product SSO flow.
5. Run focused tests, `npm test`, lint, and build.
6. Commit: `feat: protect sabc with main-site SSO`.

## Task 6: `baokuangaixie` Next.js 16 SSO gate

**Repository:** `zxc9802/baokuangaixie`  
**Files:**
- Create: `src/lib/main-app-sso.ts`
- Create: `src/app/api/sso/callback/route.ts`
- Create: `src/app/api/sso/session/route.ts`
- Create: `src/middleware.ts`
- Create: focused SSO test and add only the minimal test-runner support required to execute it

1. Write a focused callback and session-validation test first. It must cover secure cookie settings, failed exchange with no cookie, and stale/revoked session rejection.
2. Run it to establish the red state.
3. Implement the same server-to-server exchange and encrypted host-only cookie contract in `src/`; protect pages and API routes while leaving the callback/static files unblocked.
4. Keep the existing IndexedDB, Chrome extension, and rewrite business flow untouched.
5. Run focused SSO test, `npm run test:extension`, lint, and build.
6. Commit: `feat: protect baokuangaixie with main-site SSO`.

## Task 7: Cross-repository verification and handoff

**Repositories:** all five

1. Inspect each commit diff and verify no unrelated dirty worktree files are staged.
2. Verify main start responses point only to the four fixed HTTPS callback hosts, and each target only calls its configured main exchange URL server-side.
3. Re-run each repository’s full scoped test/build commands. Record failures that originate from existing unrelated project defects separately from SSO outcomes.
4. Provide the exact environment-variable handoff. Do not invent or expose actual production secret values.
5. After the user approves publishing, push each repository’s feature branch or fast-forward the explicitly requested branch; deploy/restart the five services only after the matching environment values are configured.

