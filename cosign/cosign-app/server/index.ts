// Cosign local server: JSON API for the SPA, SSR share/profile pages, OG
// images, and static serving (seed imagery always; dist/ in prod mode).
// Everything is local — SQLite + files. No keys, no external calls, ever.
//
// Dev:  npm run dev      (vite on :8080 proxies /api,/s,/p,/og,/img here)
// Prod: npm run prod     (this server on :8787 serves the built SPA too)

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDb, assertSchemaAtStartup, APP_ROOT, DATA_DIR } from "./db/db.ts";
import { COOKIE_NAME, clearSessionCookie, makeSessionCookie, verifySession } from "./auth/cookie.ts";
import * as social from "./repo/social.ts";
import * as shops from "./repo/shops.ts";
import * as rank from "./repo/rank.ts";
import { discover } from "./repo/discover.ts";
import * as lists from "./repo/lists.ts";
import * as share from "./repo/share.ts";
import * as logsRepo from "./repo/logsRepo.ts";
import * as analytics from "./repo/analytics.ts";
import * as notifications from "./repo/notifications.ts";
import * as group from "./repo/group.ts";
import * as creds from "./repo/credentials.ts";
import {
  b64u,
  relyingPartyFromEnv,
  verifyAssertion,
  verifyRegistration,
  ES256,
  RS256,
} from "./auth/webauthn.ts";
import { MAX_PARTICIPANTS } from "../src/lib/group.ts";
import { importSavedPlaces } from "./import/takeout.ts";
import { renderSharePage, renderTombstone } from "./pages/shareList.ts";
import { renderProfilePage } from "./pages/shareProfile.ts";
import { renderOgImage, renderProfileOgImage } from "./pages/og.ts";
import { isStale } from "../src/lib/freshness.ts";
import { phaseForDate, semesterForDate, type AcademicCalendar } from "../src/lib/calendar.ts";
import { CAMPUS_CENTER, haversineMeters, walkingMinutes, type LatLng } from "../src/lib/geo.ts";
import {
  CROWD_LEVELS,
  INTENT_TAGS,
  NOISE_LEVELS,
  type CrowdLevel,
  type IntentTag,
  type LogTaps,
  type NoiseLevel,
} from "../src/types/cosign.ts";

const PROD = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 8787);

// The academic calendar is a file, like the database is a file. COSIGN_CALENDAR
// points at a different one — another school's terms, or the fixture the Phase 4
// evidence run uses to stand the server inside finals week. It is configuration,
// not a test hook: nothing in the running server can move the date.
const CALENDAR_PATH = process.env.COSIGN_CALENDAR ?? join(APP_ROOT, "seed", "academic-calendar.json");
const calendar: AcademicCalendar = JSON.parse(readFileSync(CALENDAR_PATH, "utf-8"));

const app = new Hono<{ Variables: { userId: string | null } }>();

// ── transport ───────────────────────────────────────────────────────────────
// gzip everything compressible. The share page is measured on simulated
// Slow-4G where the LCP budget is 1.0 s and the document sits on the critical
// path — uncompressed HTML spends ~50 ms of that budget on bytes alone.
app.use("*", compress());

// ── session ─────────────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  c.set("userId", verifySession(c.req.header("cookie")));
  await next();
});

const me = (c: { get: (k: "userId") => string | null }) => c.get("userId");

// ── errors ──────────────────────────────────────────────────────────────────
// A malformed JSON body and a constraint a route guard missed are both the
// caller's problem and get the same opaque 400 — the constraint text names
// columns. Anything else is ours: logged here, never described to the client.
app.onError((err, c) => {
  // node:sqlite spells these "UNIQUE constraint failed: …" and "CHECK
  // constraint failed: …" without the SQLITE_CONSTRAINT prefix, so the
  // original pattern missed the one an ordinary user hits: two people adding
  // the same place to a shared list from stale pages, or one person answering
  // a group session from two browsers. Those are bad requests, not 500s.
  if (err instanceof SyntaxError || /SQLITE_CONSTRAINT|UNIQUE constraint|CHECK constraint|FOREIGN KEY/i.test(err.message)) {
    return c.json({ error: "bad request" }, 400);
  }
  console.error(err);
  return c.json({ error: "server error" }, 500);
});

/**
 * Is the credential-free user switcher available? Off in production unless the
 * operator turns it on. `npm run dev` sets no NODE_ENV, so it is on there; the
 * evidence scripts export COSIGN_DEV_AUTH=1 because the e2e suites use it.
 */
const DEV_AUTH =
  process.env.COSIGN_DEV_AUTH === "1" || process.env.NODE_ENV !== "production";

// ── auth: dev user-switcher over seeded users (signed cookie) ───────────────
app.get("/api/me", (c) => {
  const uid = me(c);
  const user = uid ? social.userById(getDb(), uid) : null;
  return c.json({ user });
});

// The roster the switcher offers. Same gate: a list of every account on the
// server is not something a stranger gets to read.
app.get("/api/auth/users", (c) =>
  DEV_AUTH
    ? c.json({ users: social.listUsers(getDb()), dev_auth: true })
    : c.json({ users: [], dev_auth: false }),
);

/**
 * The dev user-switcher, and the reason it is now behind a switch of its own.
 *
 * This route takes a user id and no credential at all and hands back that
 * person's session. That is auth v1 exactly as the brief specifies it, and it
 * is correct on a laptop demoing seeded accounts. On anything reachable from
 * outside it is an open door with a doorbell: POST a user id, be that person.
 *
 * So it exists only when an operator has explicitly asked for it —
 * `COSIGN_DEV_AUTH=1`, or any non-production NODE_ENV, which covers
 * `npm run dev`. Every evidence script sets it, because the e2e suites sign in
 * through this route and the alternative is a WebAuthn authenticator in CI.
 * Passkeys, below, are the credential a real person uses and are always on.
 */
app.post("/api/auth/switch", async (c) => {
  if (!DEV_AUTH) {
    return c.json(
      { error: "the user switcher is off — sign in with a passkey", dev_auth: false },
      403,
    );
  }
  const { userId } = await c.req.json<{ userId: string }>();
  const user = social.userById(getDb(), userId);
  if (!user) return c.json({ error: "unknown user" }, 404);
  c.header("Set-Cookie", makeSessionCookie(user.id));
  return c.json({ user });
});

app.post("/api/auth/create", async (c) => {
  const body = await c.req.json<{ username: string; display_name: string; school_id?: string }>();
  if (!body.username?.match(/^[a-zA-Z0-9_.-]{2,24}$/)) return c.json({ error: "bad username" }, 400);
  if (!body.display_name?.trim()) return c.json({ error: "display name required" }, 400);
  const db = getDb();
  if (social.userByUsername(db, body.username)) return c.json({ error: "username taken" }, 409);
  // School comes from the seeded list, never a hardcoded campus.
  const schools = db.prepare("SELECT id FROM schools").all() as unknown as Array<{ id: string }>;
  const schoolId = body.school_id ?? schools[0]?.id;
  if (!schoolId || !schools.some((s) => s.id === schoolId)) {
    return c.json({ error: "unknown school" }, 400);
  }
  const user = social.createUser(db, {
    username: body.username,
    display_name: body.display_name.trim(),
    school_id: schoolId,
  });
  c.header("Set-Cookie", makeSessionCookie(user.id));
  return c.json({ user }, 201);
});

app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

// ── passkeys: the product's real authentication ─────────────────────────────
//
// The ceremony is two round trips each way. The server issues a challenge and
// records it; the browser has the authenticator sign it; the server verifies
// and, only then, mints the session cookie the rest of the API already uses.
// So passkeys sit *in front of* the existing session, and every route behind
// `me(c)` is unchanged.
const RP = relyingPartyFromEnv();

/** Everything a `navigator.credentials.create()` call needs from us. */
app.post("/api/auth/passkey/register/options", async (c) => {
  const db = getDb();
  const body = await c.req
    .json<{ username?: string; display_name?: string }>()
    .catch(() => ({}) as { username?: string; display_name?: string });
  const existing = me(c);

  // Two ways in: an existing session adding another device, or somebody
  // signing up. There is no third — an anonymous caller cannot ask for options
  // against a username that already exists, because that would let anybody
  // start a registration ceremony against your account.
  let user = existing ? social.userById(db, existing) : null;
  if (!user) {
    const username = body.username?.trim() ?? "";
    const display = body.display_name?.trim() ?? "";
    if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(username)) return c.json({ error: "bad username" }, 400);
    if (!display) return c.json({ error: "display name required" }, 400);
    if (social.userByUsername(db, username)) return c.json({ error: "username taken" }, 409);
    const schools = db.prepare("SELECT id FROM schools").all() as unknown as Array<{ id: string }>;
    if (!schools.length) return c.json({ error: "no schools seeded" }, 500);
    user = social.createUser(db, {
      username,
      display_name: display,
      school_id: schools[0].id,
    });
  }

  const challenge = creds.newChallenge(db, "register", user.id);
  return c.json({
    challenge,
    rp: { id: RP.id, name: RP.name },
    user: {
      // The user handle is the account id, never the username: it is stored on
      // the authenticator and shown in the platform's own passkey manager, and
      // a handle that changes when somebody renames themselves is a handle
      // that stops matching an account.
      id: b64u.encode(Buffer.from(user.id, "utf-8")),
      name: user.username,
      displayName: user.display_name,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: ES256 },
      { type: "public-key", alg: RS256 },
    ],
    // Refuse a second credential from an authenticator that already has one:
    // the platform then says "you already have a passkey for this" instead of
    // silently making a duplicate the person will never be able to tell apart.
    excludeCredentials: creds
      .credentialsFor(db, user.id)
      .map((cr) => ({ type: "public-key", id: cr.credential_id })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    attestation: "none",
    timeout: 120_000,
  });
});

app.post("/api/auth/passkey/register/verify", async (c) => {
  const db = getDb();
  const body = await c.req
    .json<{
      id?: string;
      response?: { clientDataJSON?: string; attestationObject?: string };
      label?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);
  const clientDataJSON = body.response?.clientDataJSON;
  const attestationObject = body.response?.attestationObject;
  if (!clientDataJSON || !attestationObject) return c.json({ error: "malformed response" }, 400);

  // The challenge is read out of the client data and then TAKEN, so a replay
  // of the same registration finds nothing waiting for it.
  let challenge: string;
  try {
    challenge = JSON.parse(b64u.decode(clientDataJSON).toString("utf-8")).challenge as string;
  } catch {
    return c.json({ error: "malformed response" }, 400);
  }
  const taken = creds.takeChallenge(db, challenge, "register");
  if (!taken.ok) return c.json({ error: taken.why }, 400);
  if (!taken.userId) return c.json({ error: "challenge is not bound to an account" }, 400);

  let result;
  try {
    result = verifyRegistration({
      attestationObject,
      clientDataJSON,
      expectedChallenge: challenge,
      rp: RP,
    });
  } catch (err) {
    // The reason is logged for the operator and never returned: a verification
    // failure is one bit to the caller, and the detail is a map of what this
    // server checks.
    console.warn(`passkey registration rejected: ${(err as Error).message}`);
    return c.json({ error: "that passkey could not be registered" }, 400);
  }

  if (creds.credentialById(db, result.credentialId)) {
    return c.json({ error: "that passkey is already registered" }, 409);
  }

  const label = (body.label ?? "").trim().slice(0, 40) || "This device";
  creds.addCredential(db, {
    userId: taken.userId,
    credentialId: result.credentialId,
    publicKey: result.publicKey,
    alg: result.alg,
    signCount: result.signCount,
    label,
  });

  const user = social.userById(db, taken.userId);
  c.header("Set-Cookie", makeSessionCookie(taken.userId));
  return c.json({ user }, 201);
});

/** Sign-in options. Deliberately usernameless — see the comment. */
app.post("/api/auth/passkey/authenticate/options", (c) => {
  const db = getDb();
  // `allowCredentials` is left EMPTY on purpose. Naming the credentials for a
  // username would answer "does this person have an account here", to anybody
  // who asks, about a product whose whole privacy model is friends-only. With
  // an empty list the platform offers whichever passkeys it holds for this RP
  // and we learn who it is from the credential that comes back.
  const challenge = creds.newChallenge(db, "authenticate", null);
  return c.json({
    challenge,
    rpId: RP.id,
    userVerification: "preferred",
    timeout: 120_000,
  });
});

app.post("/api/auth/passkey/authenticate/verify", async (c) => {
  const db = getDb();
  const body = await c.req
    .json<{
      id?: string;
      response?: {
        clientDataJSON?: string;
        authenticatorData?: string;
        signature?: string;
        userHandle?: string | null;
      };
    }>()
    .catch(() => ({}) as Record<string, never>);
  const r = body.response;
  if (!body.id || !r?.clientDataJSON || !r.authenticatorData || !r.signature) {
    return c.json({ error: "malformed response" }, 400);
  }

  let challenge: string;
  try {
    challenge = JSON.parse(b64u.decode(r.clientDataJSON).toString("utf-8")).challenge as string;
  } catch {
    return c.json({ error: "malformed response" }, 400);
  }
  const taken = creds.takeChallenge(db, challenge, "authenticate");
  if (!taken.ok) return c.json({ error: taken.why }, 400);

  const stored = creds.credentialById(db, body.id);
  // Same message and same status as a failed signature, on purpose: "no such
  // passkey" and "wrong signature" must not be distinguishable from outside.
  const refuse = () => c.json({ error: "that passkey was not recognised" }, 401);
  if (!stored) return refuse();

  let result;
  try {
    result = verifyAssertion({
      authenticatorData: r.authenticatorData,
      clientDataJSON: r.clientDataJSON,
      signature: r.signature,
      storedPublicKey: stored.public_key,
      storedSignCount: stored.sign_count,
      expectedChallenge: challenge,
      rp: RP,
    });
  } catch (err) {
    console.warn(`passkey assertion rejected: ${(err as Error).message}`);
    return refuse();
  }

  creds.touchCredential(db, stored.credential_id, result.signCount);
  const user = social.userById(db, stored.user_id);
  if (!user) return refuse();
  c.header("Set-Cookie", makeSessionCookie(user.id));
  return c.json({ user });
});

/** The passkeys on this account, for the screen that manages them. */
app.get("/api/auth/passkeys", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const rows = creds.credentialsFor(getDb(), uid).map((cr) => ({
    // Never the credential id: it is the handle an attacker would need to
    // aim an assertion at a specific key, and this screen does not need it.
    id: cr.id,
    label: cr.label,
    created_at: cr.created_at,
    last_used_at: cr.last_used_at,
  }));
  return c.json({ passkeys: rows, dev_auth: DEV_AUTH });
});

app.delete("/api/auth/passkeys/:id", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const row = creds.credentialsFor(db, uid).find((cr) => cr.id === c.req.param("id"));
  if (!row) return c.json({ error: "not your passkey" }, 404);
  const out = creds.removeCredential(db, uid, row.credential_id);
  if (!out.ok) return c.json({ error: out.why }, 409);
  return c.json({ ok: true });
});


// ── meta ────────────────────────────────────────────────────────────────────
app.get("/api/meta", (c) => {
  const db = getDb();
  const now = new Date();
  const schools = db.prepare("SELECT * FROM schools").all();
  return c.json({
    schools,
    semester: semesterForDate(calendar, now),
    phase: phaseForDate(calendar, now),
    campus_center: CAMPUS_CENTER,
  });
});

// ── shops ───────────────────────────────────────────────────────────────────
function shopSummary(db: ReturnType<typeof getDb>, s: ReturnType<typeof shops.allShops>[number], now: Date) {
  const photos = shops.photosOf(db, s.id);
  return {
    ...s,
    photo: photos[0]?.path ?? null,
    open_now: shops.isShopOpen(db, s.id, now, calendar.timezone),
    stale: isStale(s.last_verified_at),
    distance_m: Math.round(haversineMeters(CAMPUS_CENTER, s)),
    walk_min: walkingMinutes(haversineMeters(CAMPUS_CENTER, s)),
    amenities: shops.amenitiesOf(db, s.id),
  };
}

app.get("/api/shops", (c) => {
  const db = getDb();
  const now = new Date();
  const rows = shops.allShops(db).map((s) => shopSummary(db, s, now));
  return c.json({ shops: rows });
});

app.get("/api/shops/:slug", (c) => {
  const db = getDb();
  const s = shops.shopBySlug(db, c.req.param("slug")) ?? shops.shopById(db, c.req.param("slug"));
  if (!s) return c.json({ error: "not found" }, 404);
  const uid = me(c);
  const friendIds = uid ? social.friendIdsOf(db, uid) : [];
  return c.json({
    shop: shopSummary(db, s, new Date()),
    hours: shops.hoursOf(db, s.id),
    photos: shops.photosOf(db, s.id),
    intent_tallies: shops.intentTallies(db, s.id),
    conditions: shops.conditionsByBucket(db, s.id),
    cosigners: rank.cosignersOf(db, s.id, uid),
    logs: logsRepo.visibleLogsForShop(db, s.id, uid, friendIds),
    // The viewer's own last visit, from their own logs alone — `logs` above
    // is capped at 30 and a busy shop would push theirs out of it.
    your_last_visit: uid ? logsRepo.lastVisitOf(db, s.id, uid) : null,
  });
});

// ── discovery: the surface behind Home (brief #7 and #8) ────────────────────
//
// The position is an ARGUMENT, never a stored field. It arrives on the query
// string from a momentary GeoProvider read, is used to compute distances for
// this one response, and is written nowhere — not to a row, not to an
// analytics event (decision 12: no persistent location history).
// `server/repo/discover.test.ts` proves it by sweeping every text column in
// the database for the coordinate afterwards.
function positionFrom(lat: string | undefined, lng: string | undefined): LatLng {
  // `Number("")` is 0, which is a perfectly finite coordinate in the Gulf of
  // Guinea — so an empty parameter has to be refused before it is parsed,
  // not after.
  if (!lat?.trim() || !lng?.trim()) return CAMPUS_CENTER;
  const la = Number(lat);
  const ln = Number(lng);
  const usable = Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180;
  return usable ? { lat: la, lng: ln } : CAMPUS_CENTER;
}

app.get("/api/discover", (c) =>
  c.json(
    discover(getDb(), calendar, {
      at: positionFrom(c.req.query("lat"), c.req.query("lng")),
      viewerId: me(c),
    }),
  ),
);

/**
 * "These facts are still right." The freshness signal the whole of brief #10
 * rests on, so the entitlement is enforced HERE and not only in the screen
 * that offers it: only somebody who has been in since the last confirmation
 * may confirm. Anyone else would be vouching for a room they have not seen,
 * which is exactly the unverified data the feature exists to prevent.
 */
app.post("/api/shops/:id/verify", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const shop = shops.shopById(db, c.req.param("id"));
  if (!shop) return c.json({ error: "not found" }, 404);
  const lastVisit = logsRepo.lastVisitOf(db, shop.id, uid);
  if (!lastVisit || (shop.last_verified_at && lastVisit <= shop.last_verified_at)) {
    return c.json({ error: "you haven't been in since this was last checked" }, 403);
  }
  shops.confirmFreshness(db, shop.id);
  return c.json({ ok: true });
});

// Local place search — the PlacesProvider stub over seeded shops.
app.get("/api/places/search", (c) => {
  const q = c.req.query("q") ?? "";
  if (q.length < 2) return c.json({ results: [] });
  return c.json({ results: shops.searchShops(getDb(), q) });
});

// ── rankings ────────────────────────────────────────────────────────────────
app.get("/api/rankings/me", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const entries = rank.rankingOf(db, uid).map((e) => {
    const shop = shops.shopById(db, e.shop_id);
    // with the lead photo folded in, a comparison is a photograph against a
    // photograph rather than two names
    return { ...e, shop: shop && { ...shop, photo: shops.photosOf(db, e.shop_id)[0]?.path ?? null } };
  });
  return c.json({ entries });
});

app.post("/api/rankings/insert", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{
    shop_id: string;
    position: number;
    comparisons: Array<{ winner_shop_id: string; loser_shop_id: string }>;
  }>();
  const db = getDb();
  if (typeof body?.shop_id !== "string" || !shops.shopById(db, body.shop_id)) {
    return c.json({ error: "unknown shop" }, 404);
  }
  const current = rank.rankingOf(db, uid);
  // re-ranking an existing shop doesn't grow the list, so it has one fewer slot
  const alreadyRanked = current.some((e) => e.shop_id === body.shop_id);
  const maxPosition = alreadyRanked ? current.length : current.length + 1;
  if (!(Number.isInteger(body.position) && body.position >= 1 && body.position <= maxPosition)) {
    return c.json({ error: "bad position" }, 400);
  }
  // Every tap is checked before the transaction opens. insertIntoRanking
  // writes the entries and the audit log together, so one unknown shop id
  // hits a foreign key halfway through and rolls the whole re-order back
  // with nothing to tell the caller why.
  const comparisons = Array.isArray(body.comparisons) ? body.comparisons : [];
  for (const cmp of comparisons) {
    if (typeof cmp?.winner_shop_id !== "string" || typeof cmp?.loser_shop_id !== "string") {
      return c.json({ error: "bad comparison" }, 400);
    }
    if (cmp.winner_shop_id === cmp.loser_shop_id) return c.json({ error: "bad comparison" }, 400);
    if (!shops.shopById(db, cmp.winner_shop_id) || !shops.shopById(db, cmp.loser_shop_id)) {
      return c.json({ error: "unknown shop in comparison" }, 400);
    }
  }
  rank.insertIntoRanking(db, uid, body.shop_id, body.position, comparisons);
  analytics.track(db, uid, "ranking_inserted", { shop_id: body.shop_id, comparisons: comparisons.length });
  return c.json({ entries: rank.rankingOf(db, uid) }, 201);
});

// ── users / profiles (in-app; the public surface is /p/:token) ──────────────
app.get("/api/users/:username", (c) => {
  const db = getDb();
  const user = social.userByUsername(db, c.req.param("username"));
  if (!user) return c.json({ error: "not found" }, 404);
  const uid = me(c);
  const canSeeRanking = rank.canViewRanking(db, uid, user.id);
  const entries = canSeeRanking
    ? rank.rankingOf(db, user.id).map((e) => ({ ...e, shop: shops.shopById(db, e.shop_id) }))
    : [];
  return c.json({
    user,
    is_self: uid === user.id,
    can_see_ranking: canSeeRanking,
    entries,
    // Gated like the ranking and for the same reason — but on the FRIENDS
    // predicate, not on `canSeeRanking`, which is also true for a stranger
    // when the ranking itself is public. Somebody who opted their ordering
    // into public did not thereby publish how often they write visits down.
    logs_count: logsRepo.visibleLogCount(db, user.id, uid, social.canViewFriendsOnly(db, uid, user.id)),
  });
});

// ── logs ────────────────────────────────────────────────────────────────────

/**
 * A log photo is either one of the 40 committed seed images or a file this
 * server itself wrote in POST /api/uploads. The column is rendered verbatim
 * on pages, so an arbitrary client string is a path of the caller's choosing
 * into someone else's list.
 */
const SEED_PHOTO = /^\/img\/logs\/log-\d{3}\.svg$/;
const UPLOADED_PHOTO = /^\/u\/[A-Za-z0-9_-]{8,64}\.(?:jpg|png|webp)$/;
const isLogPhoto = (p: unknown): p is string =>
  typeof p === "string" && (SEED_PHOTO.test(p) || UPLOADED_PHOTO.test(p));

app.get("/api/logs/mine", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  return c.json({ logs: logsRepo.logsOfUser(getDb(), uid, uid, true) });
});

app.post("/api/logs", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{
    shop_id: string;
    intent_tag: IntentTag;
    noise?: NoiseLevel | null;
    crowd?: CrowdLevel | null;
    taps?: LogTaps;
    line?: string | null;
    photo?: string | null;
  }>();
  const db = getDb();
  if (typeof body?.shop_id !== "string" || !shops.shopById(db, body.shop_id)) {
    return c.json({ error: "unknown shop" }, 404);
  }
  if (!INTENT_TAGS.includes(body.intent_tag)) return c.json({ error: "bad intent tag" }, 400);
  // noise/crowd are labeled enums (decision 7). Unguarded they fall through
  // to the table's CHECK and surface as a 500 for what is a bad request.
  if (body.noise != null && !NOISE_LEVELS.includes(body.noise)) return c.json({ error: "bad noise" }, 400);
  if (body.crowd != null && !CROWD_LEVELS.includes(body.crowd)) return c.json({ error: "bad crowd" }, 400);
  if (body.line && body.line.length > 140) return c.json({ error: "line too long" }, 400);
  if (body.photo != null && !isLogPhoto(body.photo)) return c.json({ error: "bad photo" }, 400);
  // Each field by name: the body is spread nowhere near user_id, so a signed-in
  // client cannot attribute a log to somebody else. visibility is never taken
  // from the client either — friends-only is the default and a share token is
  // the only way anything goes public (decision 12).
  const log = logsRepo.createLog(db, calendar, {
    user_id: uid,
    shop_id: body.shop_id,
    intent_tag: body.intent_tag,
    noise: body.noise ?? null,
    crowd: body.crowd ?? null,
    taps: body.taps,
    line: body.line ?? null,
    photo: body.photo ?? null,
  });
  analytics.track(db, uid, "log_created", { shop_id: body.shop_id });
  return c.json({ log }, 201);
});

// ── uploads ─────────────────────────────────────────────────────────────────
// The optional log photo, and the only surface in the app that writes a file
// rather than a row. Nothing about the file comes from the caller: the bytes
// are sniffed, the name is generated here, and it lands under server/data/
// (gitignored) — local, like everything else.
const UPLOAD_DIR = join(DATA_DIR, "uploads");
const MAX_PHOTO_BYTES = 2_000_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

mkdirSync(UPLOAD_DIR, { recursive: true });

/** The declared mime type is a claim; the first bytes are the evidence. */
function sniffImage(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return "png";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

app.post("/api/uploads", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{ data?: string }>();
  const m =
    typeof body?.data === "string"
      ? body.data.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/)
      : null;
  if (!m) return c.json({ error: "bad image" }, 400);
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length > MAX_PHOTO_BYTES) return c.json({ error: "photo too large" }, 413);
  const ext = sniffImage(bytes);
  if (!ext) return c.json({ error: "not an image" }, 400);
  const file = `${randomUUID().replace(/-/g, "")}.${ext}`;
  writeFileSync(join(UPLOAD_DIR, file), bytes);
  return c.json({ path: `/u/${file}` }, 201);
});

// ── import: Google Maps saved places (brief #9) ─────────────────────────────
//
// The file arrives as text, is matched in memory, and is thrown away. What
// comes back names shops and repeats the person's own notes; it carries no
// coordinate and no address, because the response is the only thing that
// survives this request and decision 12 says a position is read momentarily
// and never stored. The list they build from it holds shop ids and notes.
const MAX_IMPORT_BYTES = 4_000_000;
const MAX_IMPORT_FILES = 8;

app.post("/api/import/takeout", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{ files?: unknown }>();
  const files = Array.isArray(body?.files) ? body.files : null;
  if (!files || files.length === 0 || files.length > MAX_IMPORT_FILES) {
    return c.json({ error: "send between 1 and 8 files" }, 400);
  }
  if (!files.every((f) => typeof f === "string")) return c.json({ error: "files must be text" }, 400);
  const texts = files as string[];
  if (texts.reduce((n, t) => n + t.length, 0) > MAX_IMPORT_BYTES) {
    return c.json({ error: "that export is too big to read here" }, 413);
  }

  const db = getDb();
  let report: ReturnType<typeof importSavedPlaces>;
  try {
    report = importSavedPlaces(
      texts,
      shops.allShops(db).map((s) => ({ id: s.id, slug: s.slug, name: s.name, lat: s.lat, lng: s.lng })),
    );
  } catch (err) {
    // The parsers throw sentences meant to be read by whoever picked the
    // wrong file out of a Takeout zip, so this one error is passed through.
    return c.json({ error: err instanceof Error ? err.message : "that file could not be read" }, 400);
  }

  analytics.track(db, uid, "import_previewed", { total: report.counts.total, matched: report.counts.certain });
  return c.json({
    counts: report.counts,
    matches: report.matches.map((m) => ({
      saved: m.place.name,
      note: m.place.note,
      kind: m.kind,
      because: m.because,
      distance_m: m.distance_m,
      shop: m.shop
        ? {
            id: m.shop.id,
            slug: m.shop.slug,
            name: m.shop.name,
            palette: shops.shopById(db, m.shop.id)?.palette ?? null,
            photo: shops.photosOf(db, m.shop.id)[0]?.path ?? null,
          }
        : null,
    })),
  });
});

// ── lists ───────────────────────────────────────────────────────────────────
app.get("/api/lists/mine", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  return c.json({ lists: lists.listsOwnedBy(getDb(), uid) });
});

app.get("/api/lists/:id", (c) => {
  const db = getDb();
  const list = lists.listById(db, c.req.param("id"));
  if (!list) return c.json({ error: "not found" }, 404);
  const uid = me(c);
  if (!lists.canViewList(db, uid, list)) return c.json({ error: "not found" }, 404);
  // The derived order is computed for the reader and written nowhere: a list
  // only moves when an editor says so (POST .../rerank), because a list that
  // silently re-ordered itself would be a change nobody made.
  //
  // `derivedOrderFor` — not `derivedOrder`. The ORDER comes from everybody;
  // what each contributor's ranking says is gated on `rank.canViewRanking`,
  // because being a friend of this list's owner is not being a friend of its
  // editors, and this route answers logged-out callers.
  const derived = lists.derivedOrderFor(db, list, uid);
  const coverage = lists.coverageOf(db, list);
  const owner = social.userById(db, list.owner_id);
  return c.json({
    list,
    items: lists.itemsOf(db, list.id).map((it) => ({
      ...it,
      // The lead photograph, so a shared list reads like the share page and
      // the designed plate stays the exception rather than the default.
      shop: { ...shops.shopById(db, it.shop_id)!, photo: shops.photosOf(db, it.shop_id)[0]?.path ?? null },
    })),
    editors: lists.editorsOf(db, list.id),
    can_edit: uid ? lists.canEditList(db, uid, list) : false,
    is_owner: uid === list.owner_id,
    contributors: [
      ...(owner ? [owner] : []),
      ...lists.editorUsersOf(db, list.id).filter((u) => u.id !== list.owner_id),
    ].map((u) => ({
      user_id: u.id,
      display_name: u.display_name,
      username: u.username,
      // A count about THIS list, which survives the redaction above — the
      // page can still say where the order came from without saying what
      // anybody's private ordering is.
      ranked: coverage[u.id] ?? 0,
    })),
    // Is the list already in the order its contributors imply?
    derived: { ...derived, settled: lists.isSettled(db, list) },
    last_rerank: lists.lastRerank(db, list.id),
  });
});

/**
 * An editor puts the list in the order the contributors' own rankings imply.
 * It is a human action with a record (`list_reranks`), which is exactly what
 * the list_reranked notification points at — the alternative, recomputing on
 * read, would mean telling people about a change nobody made.
 */
app.post("/api/lists/:id/rerank", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const list = lists.listById(db, c.req.param("id"));
  if (!list || !lists.canEditList(db, uid, list)) return c.json({ error: "not found" }, 404);
  const rr = lists.rerank(db, list, uid);
  if (!rr) return c.json({ error: "nothing to move" }, 409);
  return c.json({ rerank: rr }, 201);
});

/** Only the owner hands over the pen (server/repo/lists.ts explains why). */
app.post("/api/lists/:id/editors", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const list = lists.listById(db, c.req.param("id"));
  if (!list) return c.json({ error: "not found" }, 404);
  if (list.owner_id !== uid) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ username?: string }>();
  const user = body.username ? social.userByUsername(db, body.username) : null;
  if (!user) return c.json({ error: "no one by that name" }, 404);
  // Only somebody you have actually agreed to know. An editor is write
  // access to your list; a username box that reaches strangers is a way to
  // put your list in the hands of anybody who can guess a handle.
  if (!social.areFriends(db, uid, user.id)) return c.json({ error: "add them as a friend first" }, 403);
  const added = lists.addEditor(db, list, user.id, uid);
  if (!added) return c.json({ error: "already an editor" }, 409);
  return c.json({ ok: true }, 201);
});

app.post("/api/lists", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{
    title: string;
    is_collaborative?: boolean;
    items?: Array<{ shop_id: string; note?: string | null }>;
  }>();
  if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
  // A list may arrive with its contents. An import is eleven places at once,
  // and eleven round trips means a dropped connection leaves a list holding
  // some of what somebody asked for and no way to tell which — so the whole
  // thing is one request, checked before it opens and written in one go.
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 200) return c.json({ error: "too many places" }, 400);
  const db = getDb();
  for (const it of items) {
    if (typeof it?.shop_id !== "string" || !shops.shopById(db, it.shop_id)) {
      return c.json({ error: "unknown shop" }, 404);
    }
    if (it.note != null && (typeof it.note !== "string" || it.note.length > 140)) {
      return c.json({ error: "note too long" }, 400);
    }
  }
  const seen = new Set<string>();
  const list = lists.createList(db, {
    owner_id: uid,
    title: body.title.trim(),
    is_collaborative: body.is_collaborative,
  });
  for (const it of items) {
    if (seen.has(it.shop_id)) continue; // list_items is keyed (list, shop)
    seen.add(it.shop_id);
    lists.addItem(db, list.id, it.shop_id, uid, it.note?.trim() || undefined);
  }
  return c.json({ list, items: seen.size }, 201);
});

app.post("/api/lists/:id/items", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const list = lists.listById(db, c.req.param("id"));
  if (!list || !lists.canEditList(db, uid, list)) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ shop_id: string; note?: string }>();
  if (!shops.shopById(db, body.shop_id)) return c.json({ error: "unknown shop" }, 404);
  lists.addItem(db, list.id, body.shop_id, uid, body.note);
  return c.json({ ok: true }, 201);
});

app.delete("/api/lists/:id/items/:shopId", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const list = lists.listById(db, c.req.param("id"));
  if (!list || !lists.canEditList(db, uid, list)) return c.json({ error: "not found" }, 404);
  lists.removeItem(db, list.id, c.req.param("shopId"));
  return c.json({ ok: true });
});

// ── friends (Phase 5B) ──────────────────────────────────────────────────────
//
// Asking and answering are the two human actions the friend half of the
// notification feed is made of. Both write the friendship row and its
// notification in the same repo call, so neither can happen without the other.

app.get("/api/friends", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  return c.json(social.friendshipsOf(getDb(), uid));
});

app.post("/api/friends/request", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{ username?: string }>();
  const db = getDb();
  const target = body.username ? social.userByUsername(db, body.username) : null;
  if (!target) return c.json({ error: "no one by that name" }, 404);
  if (target.id === uid) return c.json({ error: "that's you" }, 400);
  const friendship = social.requestFriendship(db, uid, target.id);
  return c.json({ friendship }, 201);
});

app.post("/api/friends/:id/accept", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  // acceptFriendship refuses anything not addressed to this user, so a 404
  // covers "no such request" and "not yours to answer" identically — the
  // second must not be distinguishable, or it enumerates other people's.
  const friendship = social.acceptFriendship(getDb(), c.req.param("id"), uid);
  return friendship ? c.json({ friendship }) : c.json({ error: "not found" }, 404);
});

// ── notifications (brief #11) ───────────────────────────────────────────────
//
// Read-only apart from marking your own as read. Nothing here creates a
// notification: the five human actions that do live in the routes that
// perform them, and server/repo/notifications.ts is the only file that can
// write the table at all.

app.get("/api/notifications", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  return c.json({ entries: notifications.feedFor(getDb(), uid) });
});

app.post("/api/notifications/read", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{ ids?: unknown }>();
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length > 200) return c.json({ error: "too many" }, 400);
  return c.json({ read: notifications.markRead(getDb(), uid, ids) });
});

// ── group decision mode (brief #8) ──────────────────────────────────────────
//
// Reading a session and answering it NEVER require a login: the brief's
// group mode is four people around a table, one of whom sent a link, and an
// account is not the price of saying what you need. Signing in only adds
// your own ordered list to the arithmetic. Starting a session and closing it
// do require an account, because both are things done in somebody's name.

app.post("/api/group", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const user = social.userById(db, uid)!;
  const body = await c.req.json<{ invite?: unknown }>();
  const usernames = Array.isArray(body?.invite)
    ? body.invite.filter((x): x is string => typeof x === "string").slice(0, MAX_PARTICIPANTS - 1)
    : [];
  const invite: string[] = [];
  for (const username of usernames) {
    const friend = social.userByUsername(db, username);
    // You can only ask somebody you know. Otherwise "start a session" is an
    // unsolicited message to any handle you can guess.
    if (!friend || !social.areFriends(db, uid, friend.id)) {
      return c.json({ error: `you and @${username} aren't friends yet` }, 403);
    }
    invite.push(friend.id);
  }
  const session = group.createSession(db, { createdBy: uid, schoolId: user.school_id, invite });
  analytics.track(db, uid, "group_started", { invited: invite.length });
  return c.json({ session }, 201);
});

app.get("/api/group/:id", (c) => {
  const view = group.sessionView(getDb(), calendar, c.req.param("id"), {
    at: positionFrom(c.req.query("lat"), c.req.query("lng")),
    participantToken: c.req.query("pt") ?? null,
    // Decides whether anybody's position appears on the payload at all.
    viewerId: me(c),
  });
  return view ? c.json(view) : c.json({ error: "not found" }, 404);
});

app.post("/api/group/:id/needs", async (c) => {
  const db = getDb();
  const session = group.sessionById(db, c.req.param("id"));
  if (!session) return c.json({ error: "not found" }, 404);
  if (session.status !== "open") return c.json({ error: "that one is settled" }, 409);
  const body = await c.req.json<{
    participant_token?: string;
    display_name?: string | null;
    intent_tag?: IntentTag | null;
    outlets?: boolean;
    open_now?: boolean;
    wifi?: boolean;
    max_noise?: NoiseLevel | null;
  }>();
  if (typeof body?.participant_token !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(body.participant_token)) {
    return c.json({ error: "bad participant" }, 400);
  }
  if (body.intent_tag != null && !INTENT_TAGS.includes(body.intent_tag)) {
    return c.json({ error: "bad intent tag" }, 400);
  }
  if (body.max_noise != null && !NOISE_LEVELS.includes(body.max_noise)) {
    return c.json({ error: "bad noise" }, 400);
  }
  const uid = me(c);
  const user = uid ? social.userById(db, uid) : null;
  // A signed-in seat brings a ranked list, so it has to be a seat everybody
  // already at the table has agreed to sit next to — see server/repo/group.ts.
  // Anybody may still join anonymously; that seat carries no list.
  if (user && !group.mayJoin(db, session.id, user.id)) {
    return c.json({ error: "you and somebody at this table aren't friends yet" }, 403);
  }
  const ok = group.submitNeeds(db, session.id, {
    participantToken: body.participant_token,
    userId: user?.id ?? null,
    // A signed-in person is named from their account, never from the body:
    // otherwise anybody with the link can answer under somebody else's name.
    displayName: user ? user.display_name.split(" ")[0] : (body.display_name?.trim().slice(0, 24) || null),
    intentTag: body.intent_tag ?? null,
    outlets: !!body.outlets,
    openNow: !!body.open_now,
    wifi: !!body.wifi,
    maxNoise: body.max_noise ?? null,
  });
  if (!ok) return c.json({ error: `that table is full at ${MAX_PARTICIPANTS}` }, 409);
  return c.json({ ok: true }, 201);
});

app.post("/api/group/:id/resolve", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const db = getDb();
  const body = await c.req.json<{ shop_id?: string | null }>();
  if (body.shop_id != null && !shops.shopById(db, body.shop_id)) {
    return c.json({ error: "unknown shop" }, 404);
  }
  const session = group.resolveSession(db, c.req.param("id"), uid, body.shop_id ?? null);
  return session ? c.json({ session }) : c.json({ error: "not found" }, 404);
});

// ── share tokens ────────────────────────────────────────────────────────────
app.get("/api/share/mine", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  return c.json({ tokens: share.tokensOf(getDb(), uid) });
});

app.post("/api/share", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{ kind: "ranking" | "list" | "profile"; list_id?: string }>();
  const db = getDb();
  if (!["ranking", "list", "profile"].includes(body.kind)) return c.json({ error: "bad kind" }, 400);
  if (body.kind === "list") {
    const list = body.list_id ? lists.listById(db, body.list_id) : null;
    if (!list || !lists.canEditList(db, uid, list)) return c.json({ error: "not found" }, 404);
  }
  const token = share.createToken(db, {
    kind: body.kind,
    user_id: uid,
    // only a list token carries a list; the schema enforces this too
    list_id: body.kind === "list" ? body.list_id! : null,
  });
  return c.json({ token }, 201);
});

app.post("/api/share/:token/revoke", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const ok = share.revokeToken(getDb(), c.req.param("token"), uid);
  return ok ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// ── analytics ───────────────────────────────────────────────────────────────
app.post("/api/events", async (c) => {
  const body = await c.req.json<{ event: string; props?: Record<string, unknown> }>();
  if (!body.event?.match(/^[a-z_]{2,40}$/)) return c.json({ error: "bad event" }, 400);
  analytics.track(getDb(), me(c), body.event, body.props ?? {});
  return c.json({ ok: true }, 201);
});

// ── public SSR share page (never touches auth) ──────────────────────────────
app.get("/s/:token", (c) => {
  const db = getDb();
  const res = share.resolveToken(db, c.req.param("token"));
  if (res.status === "missing") return c.notFound();
  if (res.status === "revoked") return c.html(renderTombstone(), 410);
  const html = renderSharePage(db, res.token, new URL(c.req.url).origin);
  if (!html) return c.notFound();
  analytics.track(db, null, "share_viewed", { token: c.req.param("token") });
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.html(html);
});

// The preview image for that link. Same token, same scope, same revocation:
// a revoked link must not keep serving a picture of the list it withdrew.
app.get("/og/s/:token", async (c) => {
  const db = getDb();
  const res = share.resolveToken(db, c.req.param("token"));
  if (res.status === "missing") return c.notFound();
  if (res.status === "revoked") return c.text("This link isn't shared anymore.", 410);
  const png = await renderOgImage(db, res.token);
  if (!png) return c.notFound();
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return c.body(png as unknown as ArrayBuffer);
});

// ── public SSR profile (Phase 5A; also never touches auth) ──────────────────
//
// Scoped strictly, in both directions: a `profile` token has 404'd at /s/
// since Phase 2, and a `ranking` or `list` token 404s here. A token is one
// surface's key, not a skeleton key — otherwise revoking the link to your
// list would leave the same content reachable through your profile's.
app.get("/p/:token", (c) => {
  const db = getDb();
  const res = share.resolveToken(db, c.req.param("token"));
  if (res.status === "missing") return c.notFound();
  if (res.status === "revoked") return c.html(renderTombstone("profile"), 410);
  const html = renderProfilePage(db, res.token, new URL(c.req.url).origin);
  if (!html) return c.notFound();
  analytics.track(db, null, "profile_viewed", { token: c.req.param("token") });
  c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return c.html(html);
});

app.get("/og/p/:token", async (c) => {
  const db = getDb();
  const res = share.resolveToken(db, c.req.param("token"));
  if (res.status === "missing") return c.notFound();
  if (res.status === "revoked") return c.text("This link isn't shared anymore.", 410);
  const png = await renderProfileOgImage(db, res.token);
  if (!png) return c.notFound();
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return c.body(png as unknown as ArrayBuffer);
});

// ── static ──────────────────────────────────────────────────────────────────
// Seed imagery and fonts are content-addressed by name and never mutate
// between builds, so they can be cached hard. Everything here is local files.
const IMMUTABLE = "public, max-age=31536000, immutable";
const immutable = (_p: string, c: { header: (k: string, v: string) => void }) =>
  c.header("Cache-Control", IMMUTABLE);

app.use(
  "/img/*",
  serveStatic({ root: "./seed/images", rewriteRequestPath: (p) => p.replace(/^\/img/, ""), onFound: immutable }),
);

// Uploaded log photos. Same treatment as seed imagery — the filename is a
// random UUID this server chose, so the bytes behind it never change.
app.use(
  "/u/*",
  serveStatic({
    root: "./server/data/uploads",
    rewriteRequestPath: (p) => p.replace(/^\/u/, ""),
    onFound: immutable,
  }),
);

// A group session is the third public, token-addressed surface: /g/<token>
// answers with no session and no auth check, exactly like /s/ and /p/. Those
// two carry `noindex, nofollow` in their own <head>, but /g/ is a client
// route inside the one SPA document, which cannot say it per-route — so the
// header says it instead. robots.txt disallows it as well; this is for the
// crawler that does not read robots.txt, which is the one that matters when
// the whole point of the address is that it was handed to a person.
app.use("/g/*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex, nofollow");
});

// In dev the SSR pages are served from here (:8787) while Vite owns :8080, so
// this server has to serve the fonts itself; in prod they come out of dist/.
if (!PROD) {
  app.use("/fonts/*", serveStatic({ root: "./public", onFound: immutable }));
}

if (PROD) {
  app.use("/assets/*", serveStatic({ root: "./dist", onFound: immutable }));
  app.use("/fonts/*", serveStatic({ root: "./dist", onFound: immutable }));
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", (c) => c.html(readFileSync(join(APP_ROOT, "dist", "index.html"), "utf-8")));
}

// Only `tsx server/index.ts` listens. Tests import this module for app.fetch
// and must not bind the port out from under a running dev server — or die on
// the EADDRINUSE guard below when one is already up.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!existsSync(join(APP_ROOT, "server", "data", "cosign.db")) && !process.env.COSIGN_DB) {
    console.error("No database found — run `npm run seed` first.");
    process.exit(1);
  }

  // The file existing is not the same as the file being current. Open it now
  // and check its tables against schema.sql, so a database built before the
  // last migration stops the process here — with the command that fixes it —
  // instead of letting it print a healthy startup line and 500 later on
  // whichever route happens to touch the new table.
  try {
    assertSchemaAtStartup();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`cosign server ${PROD ? "(prod)" : "(dev)"} on http://localhost:${info.port}`);
  });

  // A second instance must never look like it started. Without this it exits
  // quietly, the stale process keeps answering, and every check afterwards
  // measures the previous build.
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use — another cosign server is still running.\n` +
          `Stop it first (PowerShell: Get-NetTCPConnection -LocalPort ${PORT} -State Listen).`,
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
}

export { app };
