// @vitest-environment node
//
// "Notifications only from human actions — never engagement bait" (brief
// #11) is the kind of rule that is true on the day it is written and quietly
// false two features later. server/repo/notifications.test.ts proves it of
// the DATA; this proves it of the SOURCE, on every test run, the same way
// no-scales.test.ts proves the ban on rating inputs.
//
// Three things it enforces:
//
//   1. Nothing in the product can fire on a clock. No interval, no cron, no
//      polling refetch, no scheduler — the only reason this codebase would
//      ever want a repeating timer is to pull somebody back, and there is no
//      second use it is giving up. (A one-shot setTimeout is allowed: it is
//      how a "copied" label fades, and it cannot notify anybody.)
//   2. Nothing can push. No service worker, no web-push, no browser
//      Notification, no permission prompt.
//   3. The vocabulary of bait is absent: streaks, badges, points, levels,
//      leaderboards, "you haven't", "don't miss", "come back".
//
// Plus the bottleneck that makes the first three checkable at all: exactly
// one file in the repo may write the notifications table.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const SELF = resolve(HERE, "no-bait.test.ts");

interface Rule {
  name: string;
  re: RegExp;
}

const RULES: Rule[] = [
  {
    name: "a repeating timer (nothing in this product may fire on a clock)",
    re: /\b(setInterval|setImmediate|requestIdleCallback)\s*\(/,
  },
  {
    name: "a polling refetch (the page updates when a person looks at it)",
    re: /\brefetch(Interval|IntervalInBackground)\b/,
  },
  {
    name: "a scheduler",
    re: /\b(node-cron|cron\.schedule|scheduleJob|CronJob|setDriftlessInterval)\b/,
  },
  {
    name: "a push channel",
    re: /\b(serviceWorker|ServiceWorkerRegistration|webpush|web-push|PushManager|pushSubscription)\b/,
  },
  {
    name: "a browser notification or its permission prompt",
    re: /\b(new\s+Notification|Notification\.requestPermission|showNotification)\b/,
  },
  {
    name: "a streak",
    re: /\bstreaks?\b/i,
  },
  {
    name: "a badge, a point score, a level or a leaderboard",
    re: /\b(?:badges?|leaderboards?|unread[_ ]?count|points? earned|level(?:ed)? up|xp)\b/i,
  },
  {
    name: "a nudge",
    re: /\b(nudges?|re-?engage(?:ment)?|win-?back|drip campaign|daily (?:reminder|digest)|reminder email)\b/i,
  },
  {
    // Narrow on purpose. "you haven't been in since this was last checked"
    // is the re-verify prompt — an honest sentence about a fact, and the
    // opposite of a nag. What is banned is the absence NAG: a sentence built
    // out of how long it has been since you opened the app.
    name: "bait copy",
    re: /\b(don'?t miss|you haven'?t (?:logged|opened|been back|posted)[^.]{0,20}\b(?:in|for)\s+\d|come back|keep (?:it up|your streak)|on a roll|days in a row)\b/i,
  },
];

/**
 * The one carve-out, and it is exact rather than clever.
 *
 * The product PROMISES not to do these things, in words, on the two surfaces
 * where somebody would reasonably wonder — so the vocabulary of bait appears
 * in the copy that rules it out. A negation-detecting rule would be a guess;
 * a list of the exact sentences allowed to contain the words is auditable,
 * and it is short enough to read.
 *
 * The promise is CUT OUT of the line and everything else is still scanned,
 * so a promise sitting on the same line as a real badge, a real nudge or a
 * real timer buys none of them any amnesty. The scanner's own fixtures prove
 * that too.
 */
const PROMISES = [
  "There is no streak to keep, nothing to earn",
  "Cosign will not nudge anybody about it",
  "no reminder, no second ask, nothing on a timer",
  "Cosign will not send one on its own",
];

interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/**
 * Prose about the ban is not the ban — the same carve-out no-scales.test.ts
 * makes, and for the same reason: AppShell.tsx and index.css both have to be
 * able to say, in words, why there is no badge on the shelf.
 *
 * This one tracks block comments properly rather than looking at each line
 * alone, because the sentences that most need saying here are the middle
 * lines of a `/* … *\/` paragraph and those start with neither a slash nor a
 * star. A trailing comment still buys no amnesty, and neither does closing a
 * block and writing code on the same line.
 */
function isProse(line: string, inBlock: boolean): boolean {
  if (inBlock) return !/\*\/\s*\S/.test(line);
  // `--` is SQL's line comment, and schema.sql is scanned like everything else.
  return /^\s*(?:\/\/|--|\*|\/\*)/.test(line) && !/\*\/\s*\S/.test(line);
}

/**
 * Strip what only LOOKS like a comment delimiter before hunting for one.
 *
 * `line.lastIndexOf("/*")` on raw text found the `/*` inside the string
 * `"/img/*"` and inside a `--` comment containing the path `server/repo/*`,
 * opened a block that never closed, and the scanner then treated everything
 * after it as prose. That silently skipped **282 of schema.sql's 285 lines**
 * and 58 lines of server/index.ts — 13.5% of the tree — including the one
 * `.sql` file PLAN names as covered, and the same walk backs the "only the
 * repo and the seeder may write the notifications table" bottleneck.
 *
 * Quotes are removed rather than parsed: a scanner is allowed to be blunt as
 * long as it is blunt in the direction of seeing more, and the fixtures below
 * hold it to that.
 */
function withoutStringsAndLineComments(line: string): string {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/\/.*$/, "")
    .replace(/--.*$/, "");
}

/** Does this line leave a block comment open behind it? */
function opensBlock(line: string, inBlock: boolean): boolean {
  const bare = inBlock ? line : withoutStringsAndLineComments(line);
  const opens = bare.lastIndexOf("/*");
  const closes = bare.lastIndexOf("*/");
  if (inBlock) return closes === -1 || opens > closes;
  return opens !== -1 && opens > closes;
}

/** Every line of a file that is not comment prose, with its line number. */
function codeLines(source: string): Array<{ line: string; n: number }> {
  const out: Array<{ line: string; n: number }> = [];
  let inBlock = false;
  source.split(/\r?\n/).forEach((line, i) => {
    const prose = isProse(line, inBlock);
    const next = opensBlock(line, inBlock);
    if (!prose) out.push({ line, n: i + 1 });
    inBlock = next;
  });
  return out;
}

function scan(source: string, file: string): Finding[] {
  const found: Finding[] = [];
  for (const { line, n } of codeLines(source)) {
    const scrubbed = PROMISES.reduce((s, p) => s.split(p).join(" "), line);
    for (const rule of RULES) {
      if (rule.re.test(scrubbed)) {
        found.push({ file, line: n, rule: rule.name, text: line.trim().slice(0, 120) });
      }
    }
  }
  return found;
}

function report(findings: Finding[]): string {
  return findings.map((f) => `${f.file}:${f.line} — ${f.rule}\n    ${f.text}`).join("\n");
}

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) sources(path, out);
    } else if (/\.(ts|tsx|css|sql|html)$/.test(name) && resolve(path) !== SELF) {
      out.push(path);
    }
  }
  return out;
}

describe("the scanner itself", () => {
  it("catches every shape of bait", () => {
    const violations = [
      "const t = setInterval(poll, 30_000);",
      "useQuery({ queryKey: ['feed'], refetchInterval: 5000 });",
      "cron.schedule('0 9 * * *', sendDigest);",
      "navigator.serviceWorker.register('/sw.js');",
      "await Notification.requestPermission();",
      "new Notification('Someone logged a visit');",
      "const streak = daysInARow(user);",
      "<span className=\"badge\">{unreadCount}</span>",
      "const copy = `Don't miss what your friends are drinking`;",
      "const nag = \"You haven't logged anything in 3 days\";",
      "return <p>3 days in a row — keep it up</p>;",
      "const board = leaderboard(users);",
    ];
    for (const line of violations) {
      expect({ line, hits: scan(line, "fixture").length }).toBeTruthy();
      expect(scan(line, "fixture").length, line).toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves the honest things alone", () => {
    const innocent = [
      "setTimeout(() => setCopied(null), 1500);",
      "const badgeless = true;",
      "// no badges, because nothing here notifies you without a person behind it",
      "const notify = (userId: string) => { /* … */ };",
      "const days = daysSince(shop.last_verified_at);",
      "<p>Dev asked three people where to sit.</p>",
      "const remind = null;",
    ];
    expect(report(innocent.flatMap((line) => scan(line, "fixture")))).toBe("");
  });

  it("reads a whole block comment as prose, not just its first line", () => {
    const paragraph = [
      "  /* The shelf: four words on a hairline. No icons, no raised bar,",
      "     no badge — there is nothing to badge, because nothing in this",
      "     product notifies you without a person behind it. */",
      "  const shelf = tabs.map(render);",
    ].join("\n");
    expect(report(scan(paragraph, "fixture"))).toBe("");
  });

  it("lets the product say, in words, what it will not do", () => {
    const promise = "<p>There is no streak to keep, nothing to earn, and nothing on a clock.</p>";
    expect(report(scan(promise, "fixture"))).toBe("");
  });

  it("but the carve-out cuts out the promise and scans everything else", () => {
    // a promise on the same line as a timer is still a timer
    const sneaky = "const t = setInterval(poll, 1000); // Cosign will not nudge anybody about it";
    expect(scan(sneaky, "fixture")).toHaveLength(1);
    // and a promise on the same line as a badge is still a badge
    const badge = '<p>There is no streak to keep, nothing to earn</p><span className="badge">3</span>';
    expect(scan(badge, "fixture").map((f) => f.rule)).toEqual([
      "a badge, a point score, a level or a leaderboard",
    ]);
    // a second streak outside the promise is still a streak
    const twice = "<p>There is no streak to keep, nothing to earn.</p><p>Your streak is 4 days.</p>";
    expect(scan(twice, "fixture").map((f) => f.rule)).toContain("a streak");
  });

  it("a `/*` inside a string or a line comment does not open a block", () => {
    // Both of these are real lines from the tree, and each one blinded the
    // scanner to every line beneath it in its file.
    const sneaky = [
      'app.use("/img/*", serveStatic({ root: "./seed/images" }));',
      "const t = setInterval(poll, 1000);",
    ].join("\n");
    expect(scan(sneaky, "fixture")).toHaveLength(1);

    const sql = ["-- RLS policies become explicit checks in server/repo/*.", "CREATE TABLE streaks (n INT);"].join("\n");
    // nothing in the SQL is bait, but the second line must be SEEN
    expect(codeLines(sql)).toHaveLength(1);
    expect(codeLines(sql)[0].n).toBe(2);
  });

  it("scans every line of the schema, which is the file the bottleneck rests on", () => {
    const schema = readFileSync(join(APP, "server", "db", "schema.sql"), "utf-8");
    const total = schema.split(/\r?\n/).length;
    const seen = codeLines(schema).length;
    // roughly half of schema.sql is comment prose; the failure this catches
    // was 3 lines of 285 being scanned
    expect(seen).toBeGreaterThan(total * 0.4);
  });

  it("but code after a block closes on the same line is still code", () => {
    const sneaky = ["/* a note", "   spanning lines */ const t = setInterval(poll, 1000);"].join("\n");
    expect(scan(sneaky, "fixture")).toHaveLength(1);
  });
});

describe("no engagement bait anywhere in the product", () => {
  const files = [...sources(join(APP, "src")), ...sources(join(APP, "server")), ...sources(join(APP, "e2e"))];

  it("scans the whole tree, including the SQL and the e2e", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("finds none", () => {
    const findings = files.flatMap((f) =>
      scan(readFileSync(f, "utf-8"), relative(APP, f).replace(/\\/g, "/")),
    );
    expect(report(findings)).toBe("");
  });

  it("only the repo and the seeder may write the notifications table", () => {
    const writers = files
      // A test that proves the CHECK constraint rejects a sixth type has to
      // be allowed to try writing one; nothing it does ships.
      .filter((f) => !/\.test\.ts$/.test(f))
      .filter((f) =>
        codeLines(readFileSync(f, "utf-8")).some(({ line }) =>
          /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+notifications\b/i.test(line),
        ),
      );
    expect(writers.map((f) => relative(APP, f).replace(/\\/g, "/")).sort()).toEqual([
      // The seeder derives its rows from the action records already in the
      // seed files (there is no notifications.json), and the repo is the
      // single write path the running server has.
      "server/db/seed.ts",
      "server/repo/notifications.ts",
    ]);
  });

  it("and the primitives a badge would be built from stay deleted", () => {
    // Same reasoning as Phase 1's slider and Phase 3's progress/radio-group:
    // an unused primitive is the drawer somebody opens later. `badge` is the
    // unread count this phase decided against; `sidebar` is a hamburger maze
    // the brief bans, and it ships a SidebarMenuBadge inside it.
    for (const name of ["badge", "sidebar"]) {
      expect({ [name]: existsSync(join(APP, "src", "components", "ui", `${name}.tsx`)) }).toEqual({
        [name]: false,
      });
    }
  });

  it("no analytics event is named after something the app did on its own", async () => {
    const { ANALYTICS_EVENTS } = (await import("../lib/analytics")) as {
      ANALYTICS_EVENTS: readonly string[];
    };
    for (const event of ANALYTICS_EVENTS) {
      expect(/(reminder|digest|nudge|streak|retention|push|campaign)/i.test(event), event).toBe(false);
    }
  });
});
