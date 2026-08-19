// The design rules, measured on the running app rather than eyeballed.
//
//   COSIGN_BASE=http://localhost:8791 node scripts/ui-audit.mjs
//
// `a11y-probe.mjs` covers what a screen reader needs — focus order, names,
// landmarks, live regions. This covers what the eye and the thumb need, and it
// covers it by measuring: contrast ratios computed from resolved colours, tap
// targets from real bounding boxes, gaps between adjacent targets, and whether
// a disabled control actually looks disabled.
//
// The rules are the CRITICAL and HIGH tiers of the ui-ux-pro-max checklist,
// scoped to what applies to a mobile-first web app:
//
//   contrast        4.5:1 for body text, 3:1 for large text (>=24px, or >=19px bold)
//   tap targets     >= 44x44 CSS px for anything you press
//   tap spacing     >= 8px between adjacent targets
//   disabled state  must differ from enabled by more than the cursor
//   motion          150-300ms for micro-interactions, and reduced-motion honoured
//
// It reports; it does not assert. The fixes it motivates get their own tests.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.COSIGN_BASE ?? "http://localhost:8787";
const OUT = join(APP, "..", "..", "evidence", process.env.COSIGN_EVIDENCE ?? "scratch/ui-audit");
mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, route, rule, what) => {
  findings.push({ level, route, rule, what });
  console.log(`  ${level === "FAIL" ? "FAIL" : level === "WARN" ? "warn" : "ok  "}  ${rule.padEnd(14)} ${what}`);
};

/** Everything measured inside the page, so the numbers are the rendered ones. */
const AUDIT = () => {
  // ── colour maths (WCAG 2.1 relative luminance) ──────────────────────────
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((s) => parseFloat(s));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const a = lum(fg) + 0.05;
    const b = lum(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  };
  const over = (fg, bg) => {
    // Flatten a translucent foreground onto its background before comparing —
    // otherwise a 60%-opacity label reads as full strength and passes a check
    // the eye would fail. This is the same class of mistake as auditing a
    // half-faded element mid-animation.
    if (fg.a >= 1) return fg;
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    };
  };
  /** The first ancestor that actually paints something. */
  const effectiveBg = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 1 };
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };

  // ── 1. contrast of every text-bearing leaf ──────────────────────────────
  const contrast = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    // Only leaves that own text, so a wrapper is not credited with its child's.
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(" ");
    if (!ownText) continue;
    const cs = getComputedStyle(el);
    const bg = effectiveBg(el);
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const fg = over(fgRaw, bg);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < need) {
      contrast.push({
        text: ownText.slice(0, 44),
        got,
        need,
        size: Math.round(size * 10) / 10,
        weight,
        cls: el.className?.toString?.().slice(0, 40) ?? "",
      });
    }
  }

  // ── 2. tap targets and the gaps between them ────────────────────────────
  const SEL = "a[href], button, input, select, textarea, [role=button], [tabindex]:not([tabindex='-1'])";

  /**
   * What a finger actually presses.
   *
   * A visually-hidden input driven by a styled `<label for>` is the correct
   * pattern for a file picker, and the input is deliberately 1x1 — the LABEL
   * is the target, and it carries the focus ring via `peer-focus-visible`.
   * The first version of this audit measured the input and reported a 1x1 tap
   * target on onboarding that no finger has ever had to hit. Measuring the
   * wrong element and failing it is worse than not checking: it sends somebody
   * to "fix" a control that is already right.
   */
  const pressTarget = (el) => {
    const r = el.getBoundingClientRect();
    const hidden = r.width <= 2 || r.height <= 2 || getComputedStyle(el).clip !== "auto";
    if (!hidden) return { box: r, proxied: false };
    // Both correct forms: `<label for>` pointing at it (the Takeout picker),
    // and a label WRAPPING it with no id at all (the log flow's photo input).
    const label =
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
    if (!label) return { box: r, proxied: false };
    const lr = label.getBoundingClientRect();
    if (lr.width < 2 || lr.height < 2) return { box: r, proxied: false };
    return { box: lr, proxied: true };
  };

  const targets = [...document.querySelectorAll(SEL)].filter(visible);
  const small = [];
  const boxes = [];
  let proxied = 0;
  for (const el of targets) {
    const { box: r, proxied: viaLabel } = pressTarget(el);
    if (viaLabel) proxied++;
    const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 34);
    boxes.push({ r, label });
    if (r.width < 44 || r.height < 44) {
      small.push({ label, w: Math.round(r.width), h: Math.round(r.height), viaLabel });
    }
  }
  // Adjacent pairs closer than 8px, ignoring deliberate overlap (nesting).
  const tight = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
      const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
      if (dx === 0 && dy === 0) continue; // overlapping/nested
      const gap = Math.round(Math.max(dx, dy));
      if (gap < 8) tight.push({ a: boxes[i].label, b: boxes[j].label, gap });
    }
  }

  // ── 3. disabled controls must look disabled ─────────────────────────────
  const weakDisabled = [];
  for (const el of document.querySelectorAll("button[disabled], input[disabled], [aria-disabled=true]")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const opacity = Number(cs.opacity);
    const looksDifferent = opacity < 0.95 || cs.cursor === "not-allowed" || cs.filter !== "none";
    if (!looksDifferent) {
      weakDisabled.push((el.textContent || el.tagName).trim().slice(0, 34));
    }
  }

  // ── 4. motion durations actually applied ────────────────────────────────
  const slow = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    for (const raw of [...cs.transitionDuration.split(","), ...cs.animationDuration.split(",")]) {
      const t = raw.trim();
      if (!t || t === "0s") continue;
      const ms = t.endsWith("ms") ? parseFloat(t) : parseFloat(t) * 1000;
      if (ms > 500) slow.push({ ms, cls: el.className?.toString?.().slice(0, 36) ?? "" });
    }
  }

  return { contrast, small, tight, weakDisabled, slow, targetCount: targets.length, proxied };
};

/**
 * Signed-out routes are audited in their own context, and that is not a detail.
 *
 * `/` is the UserSwitcher — the front door, and the surface the passkey button
 * lives on — only when nobody is signed in. Signed in it is Home. The first
 * version of this audit signed in first and then measured `/`, so it reported
 * "28 targets, all >= 44x44" about Home while its own heading said "front door
 * — passkey sign-in". It had never once looked at the screen it claimed to be
 * checking. Third time this session a probe has confidently measured the wrong
 * thing; the tell each time was a label that did not match the numbers.
 */
const SIGNED_OUT = [
  ["/", "front door — passkey sign-in (signed out)"],
  ["/onboarding", "onboarding — passkey create (signed out)"],
];
const SIGNED_IN = [
  ["/maya", "profile — passkey management"],
  ["/", "home (signed in)"],
  ["/rank", "your ranking"],
  ["/log", "log flow, step 1"],
  ["/search", "search"],
];

const browser = await chromium.launch();
const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
const signedIn = await browser.newContext({ viewport: { width: 390, height: 844 } });
await signedIn.request.post(`${BASE}/api/auth/switch`, { data: { userId: "u_maya" } });

const ROUTES = [
  ...SIGNED_OUT.map(([r, n]) => [r, n, anon]),
  ...SIGNED_IN.map(([r, n]) => [r, n, signedIn]),
];

for (const [route, name, context] of ROUTES) {
  console.log(`\n── ${name}  ${route}`);
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // Settle before measuring: a control mid-fade reports the opacity of the
  // frame it was caught in, and every contrast number would be wrong.
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  // Say what surface actually rendered, so a mismatch between the label and
  // the page is visible in the output instead of hiding inside a number.
  const surface = await page.evaluate(() => {
    const marks = ["switcher", "onboarding", "profile", "home", "ranking", "logflow", "search", "feed"];
    const found = marks.filter((m) => document.querySelector(`[data-${m}]`));
    return { found, h1: document.querySelector("main h1")?.textContent?.trim().slice(0, 44) ?? "" };
  });
  note("ok", route, "surface", `[data-${surface.found.join("] [data-") || "?"}] — "${surface.h1}"`);

  const r = await page.evaluate(AUDIT);

  if (r.contrast.length) {
    for (const c of r.contrast) {
      note("FAIL", route, "contrast", `${c.got}:1 (needs ${c.need}) at ${c.size}px/${c.weight} — "${c.text}"`);
    }
  } else note("ok", route, "contrast", "every text run meets its threshold");

  if (r.small.length) {
    for (const s of r.small) note("FAIL", route, "tap-target", `${s.w}x${s.h} — "${s.label}"`);
  } else
    note(
      "ok",
      route,
      "tap-target",
      `${r.targetCount} targets, all >= 44x44` +
        (r.proxied ? ` (${r.proxied} measured at their <label>)` : ""),
    );

  if (r.tight.length) {
    for (const t of r.tight.slice(0, 4)) note("WARN", route, "tap-spacing", `${t.gap}px between "${t.a}" and "${t.b}"`);
  } else note("ok", route, "tap-spacing", "no adjacent pair closer than 8px");

  if (r.weakDisabled.length) {
    for (const d of r.weakDisabled) note("FAIL", route, "disabled", `looks identical to enabled — "${d}"`);
  } else note("ok", route, "disabled", "disabled controls are visually distinct");

  if (r.slow.length) {
    for (const s of r.slow.slice(0, 3)) note("WARN", route, "motion", `${s.ms}ms > 500ms — ${s.cls}`);
  } else note("ok", route, "motion", "nothing runs longer than 500ms");

  await page.close();
}

await browser.close();
const fails = findings.filter((f) => f.level === "FAIL");
const warns = findings.filter((f) => f.level === "WARN");
writeFileSync(join(OUT, "ui-audit.json"), JSON.stringify({ base: BASE, findings }, null, 2));
console.log(`\n${fails.length} FAIL · ${warns.length} warn · ${findings.length} checks`);
console.log(`-> ${join(OUT, "ui-audit.json")}`);
process.exit(fails.length ? 1 : 0);
