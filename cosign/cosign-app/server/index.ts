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
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb, APP_ROOT } from "./db/db.ts";
import { COOKIE_NAME, clearSessionCookie, makeSessionCookie, verifySession } from "./auth/cookie.ts";
import * as social from "./repo/social.ts";
import * as shops from "./repo/shops.ts";
import * as rank from "./repo/rank.ts";
import * as lists from "./repo/lists.ts";
import * as share from "./repo/share.ts";
import * as logsRepo from "./repo/logsRepo.ts";
import * as analytics from "./repo/analytics.ts";
import { renderSharePage, renderTombstone } from "./pages/shareList.ts";
import { renderOgImage } from "./pages/og.ts";
import { isStale } from "../src/lib/timeBucket.ts";
import { phaseForDate, semesterForDate, type AcademicCalendar } from "../src/lib/calendar.ts";
import { CAMPUS_CENTER, haversineMeters, walkingMinutes } from "../src/lib/geo.ts";
import { INTENT_TAGS, type IntentTag } from "../src/types/cosign.ts";

const PROD = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 8787);

const calendar: AcademicCalendar = JSON.parse(
  readFileSync(join(APP_ROOT, "seed", "academic-calendar.json"), "utf-8"),
);

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

// ── auth: dev user-switcher over seeded users (signed cookie) ───────────────
app.get("/api/me", (c) => {
  const uid = me(c);
  const user = uid ? social.userById(getDb(), uid) : null;
  return c.json({ user });
});

app.get("/api/auth/users", (c) => c.json({ users: social.listUsers(getDb()) }));

app.post("/api/auth/switch", async (c) => {
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
  });
});

app.post("/api/shops/:id/verify", (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  shops.confirmFreshness(getDb(), c.req.param("id"));
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
  const entries = rank.rankingOf(db, uid).map((e) => ({
    ...e,
    shop: shops.shopById(db, e.shop_id),
  }));
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
  if (!shops.shopById(db, body.shop_id)) return c.json({ error: "unknown shop" }, 404);
  const current = rank.rankingOf(db, uid);
  // re-ranking an existing shop doesn't grow the list, so it has one fewer slot
  const alreadyRanked = current.some((e) => e.shop_id === body.shop_id);
  const maxPosition = alreadyRanked ? current.length : current.length + 1;
  if (!(Number.isInteger(body.position) && body.position >= 1 && body.position <= maxPosition)) {
    return c.json({ error: "bad position" }, 400);
  }
  rank.insertIntoRanking(db, uid, body.shop_id, body.position, body.comparisons ?? []);
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
    logs_count: (db.prepare("SELECT count(*) n FROM logs WHERE user_id = ?").get(user.id) as { n: number }).n,
  });
});

// ── logs ────────────────────────────────────────────────────────────────────
app.post("/api/logs", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{
    shop_id: string;
    intent_tag: IntentTag;
    noise?: "quiet" | "conversational" | "loud" | null;
    crowd?: "empty" | "comfortable" | "packed" | null;
    taps?: Record<string, boolean>;
    line?: string | null;
    photo?: string | null;
  }>();
  const db = getDb();
  if (!shops.shopById(db, body.shop_id)) return c.json({ error: "unknown shop" }, 404);
  if (!INTENT_TAGS.includes(body.intent_tag)) return c.json({ error: "bad intent tag" }, 400);
  if (body.line && body.line.length > 140) return c.json({ error: "line too long" }, 400);
  const log = logsRepo.createLog(db, calendar, { user_id: uid, ...body });
  analytics.track(db, uid, "log_created", { shop_id: body.shop_id });
  return c.json({ log }, 201);
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
  return c.json({
    list,
    items: lists.itemsOf(db, list.id).map((it) => ({ ...it, shop: shops.shopById(db, it.shop_id) })),
    editors: lists.editorsOf(db, list.id),
    can_edit: uid ? lists.canEditList(db, uid, list) : false,
  });
});

app.post("/api/lists", async (c) => {
  const uid = me(c);
  if (!uid) return c.json({ error: "sign in first" }, 401);
  const body = await c.req.json<{ title: string; is_collaborative?: boolean }>();
  if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
  const list = lists.createList(getDb(), { owner_id: uid, title: body.title.trim(), is_collaborative: body.is_collaborative });
  return c.json({ list }, 201);
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

if (!existsSync(join(APP_ROOT, "server", "data", "cosign.db")) && !process.env.COSIGN_DB) {
  console.error("No database found — run `npm run seed` first.");
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

export { app };
