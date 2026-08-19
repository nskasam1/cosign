// @vitest-environment node
//
// POST /api/logs is the log flow's write path, and anyone with a session
// cookie can reach it — so what it refuses matters as much as what it
// stores: attribution, visibility, the labeled enums, and the photo column
// that pages render verbatim. Driven through app.fetch, because the route
// guards are the thing under test, not the repo they call.

import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { currentTimeBucket } from "../../src/lib/timeBucket";
import { semesterForDate, type AcademicCalendar } from "../../src/lib/calendar";
import type { Log } from "../../src/types/cosign";

const dir = mkdtempSync(join(tmpdir(), "cosign-logs-"));
const dbPath = join(dir, "test.db");
// db.ts reads COSIGN_DB once, at module load, so everything that touches it
// has to be imported dynamically below: a static import is hoisted above
// this line and would open server/data/cosign.db, which a running server
// holds a lock on.
process.env.COSIGN_DB = dbPath;

const { createDb, getDb, closeDb, APP_ROOT, DATA_DIR } = await import("../db/db");
createDb(dbPath).close();
const db = getDb();

const { app } = await import("../index");
const { makeSessionCookie } = await import("../auth/cookie");
const { createLog } = await import("./logsRepo");

db.exec(`INSERT INTO schools (id, name) VALUES ('osu', 'Ohio State University');`);
for (const u of ["u_me", "u_maya"]) {
  db.prepare(
    "INSERT INTO users (id, username, display_name, school_id, created_at) VALUES (?,?,?,?,?)",
  ).run(u, u.slice(2), u, "osu", "2026-01-01T00:00:00Z");
}
db.prepare(
  "INSERT INTO shops (id, slug, name, address, lat, lng, school_id, student_discount, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
).run("s_alpha", "alpha", "Alpha", "1 High St", 40, -83, "osu", 0, "2026-01-01T00:00:00Z");
db.exec(
  `INSERT INTO logs (id, user_id, shop_id, intent_tag, time_bucket, semester, taps_json, visibility, created_at)
   VALUES ('lg_maya','u_maya','s_alpha','reading','morning','2026-autumn','{}','friends','2026-08-01T10:00:00Z')`,
);

const count = (sql: string) => (db.prepare(`SELECT count(*) n FROM ${sql}`).get() as { n: number }).n;
const cookie = (userId: string) => makeSessionCookie(userId).split(";")[0];

const call = (path: string, init: RequestInit & { as?: string | null } = {}) => {
  const { as = "u_me", ...rest } = init;
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(as ? { Cookie: cookie(as) } : {}),
      },
    }),
  );
};

const postLog = (body: unknown, as: string | null = "u_me") =>
  call("/api/logs", { method: "POST", body: JSON.stringify(body), as });

const ok = { shop_id: "s_alpha", intent_tag: "deep_work" };
const uploaded: string[] = [];

describe("a log belongs to the cookie, not to the body", () => {
  it("ignores a body user_id", async () => {
    const res = await postLog({ ...ok, user_id: "u_maya" });
    expect(res.status).toBe(201);
    const { log } = (await res.json()) as { log: Log };
    expect(log.user_id).toBe("u_me");
    expect((db.prepare("SELECT user_id FROM logs WHERE id = ?").get(log.id) as { user_id: string }).user_id).toBe(
      "u_me",
    );
    expect(count("logs WHERE user_id = 'u_maya'")).toBe(1); // the seeded one, no forgery
  });

  it("ignores a body visibility — friends-only is not advisory", async () => {
    const res = await postLog({ ...ok, visibility: "public" });
    const { log } = (await res.json()) as { log: Log };
    expect(log.visibility).toBe("friends");
    expect(count("logs WHERE visibility = 'public'")).toBe(0);
  });

  it("refuses to write at all without a session", async () => {
    expect((await postLog(ok, null)).status).toBe(401);
  });
});

describe("the labeled enums are checked at the route, not by the CHECK constraint", () => {
  it("rejects a numeric noise with 400, not a 500 out of SQLite", async () => {
    const res = await postLog({ ...ok, noise: 3 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad noise" });
  });

  it("rejects an unknown crowd label with 400", async () => {
    const res = await postLog({ ...ok, crowd: "heaving" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad crowd" });
  });

  it("accepts the real labels", async () => {
    expect((await postLog({ ...ok, noise: "quiet", crowd: "comfortable" })).status).toBe(201);
  });

  it("answers an empty body with 404, not a 500", async () => {
    const res = await postLog({});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown shop" });
  });

  it("answers malformed JSON with 400", async () => {
    const res = await call("/api/logs", { method: "POST", body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request" });
  });

  // The taps whitelist is the storage-layer half of the no-rating-scales
  // rule: without it a client could smuggle a numeric field into a log and
  // defeat at the database what the UI refuses to render.
  it("stores only the four whitelisted taps, coerced to booleans", async () => {
    const res = await postLog({
      ...ok,
      taps: { found_outlet: true, wifi_held_up: 1, rating: 5, stars: 4.5, noise_score: 3 },
    });
    expect(res.status).toBe(201);
    const { log } = (await res.json()) as { log: Log };
    expect(log.taps).toEqual({ found_outlet: true, wifi_held_up: true });
    const stored = (db.prepare("SELECT taps_json FROM logs WHERE id = ?").get(log.id) as { taps_json: string })
      .taps_json;
    expect(stored).not.toMatch(/rating|stars|score|[0-9]/);
  });
});

describe("the photo column is an allowlist", () => {
  it("refuses a path of the caller's choosing", async () => {
    const res = await postLog({ ...ok, photo: "../../etc/passwd" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad photo" });
    expect(count("logs WHERE photo IS NOT NULL")).toBe(0);
  });

  it("accepts a committed seed image", async () => {
    const res = await postLog({ ...ok, photo: "/img/logs/log-001.svg" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { log: Log }).log.photo).toBe("/img/logs/log-001.svg");
  });
});

describe("time_bucket and semester are stamped from the clock", () => {
  const calendar: AcademicCalendar = {
    school: "osu",
    timezone: "America/New_York",
    terms: [
      {
        slug: "2026-autumn",
        name: "Autumn 2026",
        start: "2026-08-25",
        end: "2026-12-16",
        week_one_end: "2026-08-30",
        finals_start: "2026-12-09",
      },
    ],
  };

  it("takes both from the injected date", () => {
    const log = createLog(
      db,
      calendar,
      { user_id: "u_me", shop_id: "s_alpha", intent_tag: "late_night" },
      new Date(2026, 8, 10, 23, 30), // local 11:30pm, inside Autumn 2026
    );
    expect(log.time_bucket).toBe("late_night");
    expect(log.semester).toBe("2026-autumn");
  });

  it("says break outside every term", () => {
    const log = createLog(
      db,
      calendar,
      { user_id: "u_me", shop_id: "s_alpha", intent_tag: "quick_grab" },
      new Date(2026, 6, 4, 9, 0),
    );
    expect(log.semester).toBe("break");
    expect(log.time_bucket).toBe("morning");
  });

  it("never takes either from the client body", async () => {
    const res = await postLog({ ...ok, time_bucket: "morning", semester: "1999-fall" });
    const { log } = (await res.json()) as { log: Log };
    expect(log.semester).not.toBe("1999-fall");
    expect(log.time_bucket).toBe(currentTimeBucket(new Date()));
    // and it is the server's own committed calendar that decided the semester
    const seeded: AcademicCalendar = JSON.parse(
      readFileSync(join(APP_ROOT, "seed", "academic-calendar.json"), "utf-8"),
    );
    expect(log.semester).toBe(semesterForDate(seeded, new Date()));
  });
});

describe("GET /api/logs/mine", () => {
  it("needs a session", async () => {
    expect((await call("/api/logs/mine", { as: null })).status).toBe(401);
  });

  it("returns the signed-in user's logs and nobody else's", async () => {
    const res = await call("/api/logs/mine");
    expect(res.status).toBe(200);
    const { logs } = (await res.json()) as { logs: Log[] };
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.user_id === "u_me")).toBe(true);
    expect(logs.some((l) => l.id === "lg_maya")).toBe(false);
  });
});

describe("POST /api/uploads is the only way to obtain a photo path", () => {
  // The sniff reads the leading bytes only; the rest is filler.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 7),
  ]);
  const dataUrl = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString("base64")}`;

  const upload = (data: unknown, as: string | null = "u_me") =>
    call("/api/uploads", { method: "POST", body: JSON.stringify({ data }), as });

  it("needs a session", async () => {
    expect((await upload(dataUrl("image/png", png), null)).status).toBe(401);
  });

  it("rejects anything that is not an image data URL", async () => {
    expect((await upload("hello")).status).toBe(400);
    expect((await upload(dataUrl("text/html", png))).status).toBe(400);
  });

  it("sniffs the magic bytes rather than trusting the declared mime", async () => {
    const res = await upload(dataUrl("image/png", Buffer.from("<script>not a picture</script>")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not an image" });
  });

  it("caps the decoded size", async () => {
    const res = await upload(dataUrl("image/png", Buffer.concat([png, Buffer.alloc(2_000_001)])));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "photo too large" });
  });

  it("names the file itself, serves it back, and that path is a legal log photo", async () => {
    const res = await upload(dataUrl("image/png", png));
    expect(res.status).toBe(201);
    const { path } = (await res.json()) as { path: string };
    expect(path).toMatch(/^\/u\/[0-9a-f]{32}\.png$/);
    uploaded.push(path);

    const served = await app.fetch(new Request(`http://localhost${path}`));
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png);

    expect((await postLog({ ...ok, photo: path })).status).toBe(201);
  });
});

afterAll(() => {
  for (const p of uploaded) unlinkSync(join(DATA_DIR, "uploads", p.replace("/u/", "")));
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
