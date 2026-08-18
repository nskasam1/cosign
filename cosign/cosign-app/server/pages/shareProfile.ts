// The public profile — /p/:token (PLAN.md, Phase 5A). The second and last
// surface that never requires auth, addressed by its own revocable token,
// hand-templated like the share page: no framework, no stylesheet request,
// no bundle.
//
// It is not the share page with a different headline. The list says what
// somebody likes; this says WHO THEY ARE ABOUT COFFEE and WHERE THEY ACTUALLY
// GO, and the second half is a shape no ranked column can make. So the two
// largest objects here are their own sentence and a drawn campus, and the
// ranked column is one link away where it belongs.
//
// Two colour laws, both inherited and both load-bearing:
//   --ink is THEIR voice; --line is OURS. The taste line is a 19px citation
//   in --line on /s/; here it is the document, in --ink, at 28/34px. That
//   escalation is the difference between a list's header and a profile.
//   Ember appears exactly three times: the line from campus to their first
//   place, the CTA, and :focus-visible. Everything else that is coloured
//   takes the place's own imagery palette, so a numeral in the list and its
//   disc on the sheet are visibly the same place.
//
// NO PRONOUNS ANYWHERE. Cosign asks for a name and a school; it has never
// been told anybody's pronouns, and this is a public page about a real
// person. Every sentence is built from the first name instead.

import type { DatabaseSync } from "node:sqlite";
import type { ShareToken } from "../../src/types/cosign.ts";
import { loadProfileData, type ProfileData, type ProfileEntry } from "./profileData.ts";
import { VB_H, VB_W, numberWord, ordinal, profileMapSvg } from "./profileMap.ts";
import { inlineSvg } from "./shareData.ts";
import { escapeHtml } from "./shareList.ts";
import { fontFaceCss, tokensCss } from "./tokens.ts";
import { article } from "../../src/lib/placeCopy.ts";

export { loadProfileData } from "./profileData.ts";

const e = escapeHtml;

/** Typographer's quotes and dashes — the copy is written, not printf'd. */
function smart(s: string): string {
  return e(s)
    .replace(/(\w)&#39;(\w)/g, "$1’$2")
    .replace(/&#39;/g, "’")
    .replace(/ - /g, " — ");
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const PAGE_CSS = `
*,::before,::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:hsl(var(--bg));color:hsl(var(--ink));font:400 var(--text-base)/var(--leading-body) var(--font-body);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
img{display:block;max-width:100%}
::selection{background:hsl(var(--ember)/.32)}
:focus-visible{outline:2px solid hsl(var(--ember));outline-offset:3px}
.wrap{max-width:37.25rem;margin:0 auto;padding:var(--space-6) var(--gutter) var(--space-10)}
.kicker{font:700 var(--text-2xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0 0 var(--space-4);padding-bottom:var(--space-4);border-bottom:1px solid hsl(var(--rule))}
/* The masthead rule draws itself, exactly as it does on /s/ — the two
   public surfaces share a vocabulary, not a template, and that now includes
   how they open. Same scoping rule: the kicker inside .cta is a section
   label and prints no rule. */
.wrap>.kicker{position:relative;border-bottom:0}
.wrap>.kicker::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:hsl(var(--rule));transform-origin:left;animation:draw var(--duration-slow) var(--ease-out) both}
@keyframes draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.who{display:flex;align-items:center;gap:var(--space-3);margin:0 0 var(--space-5)}
.who img{width:48px;height:48px;border-radius:var(--radius-full);flex:none;background:hsl(var(--surface))}
h1{font:400 var(--text-xl)/var(--leading-tight) var(--font-display);letter-spacing:var(--tracking-display);margin:0}
.where{font:400 var(--text-xs)/1.35 var(--font-body);color:hsl(var(--muted));margin:3px 0 0}
/* THE LCP ELEMENT: their own sentence, in their own voice, the largest thing
   on the page. Unquoted — it is the document here, not a citation. */
.taste{font:400 var(--text-2xl)/var(--leading-tight) var(--font-display);letter-spacing:var(--tracking-display);color:hsl(var(--ink));margin:0 0 var(--space-6);text-wrap:balance}
.usual{border-top:1px solid hsl(var(--rule-strong));border-bottom:1px solid hsl(var(--rule));padding:var(--space-4) 0;margin:0 0 var(--space-8)}
.usual dt{font:700 var(--text-2xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0}
.usual dd{font:400 var(--text-xl)/1.2 var(--font-display);letter-spacing:var(--tracking-display);color:hsl(var(--ink));margin:var(--space-2) 0 0}
.usual dd span{display:block;font:400 var(--text-xs)/1.5 var(--font-body);color:hsl(var(--muted));margin-top:var(--space-2)}
h2.slug{font:700 var(--text-2xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0 0 var(--space-4)}
h2.head{font:400 var(--text-xl)/1.2 var(--font-display);letter-spacing:var(--tracking-display);color:hsl(var(--ink));margin:0 0 var(--space-4)}
figure{margin:0 0 var(--space-8)}
.sheet{position:relative;width:100%;max-width:32rem;margin:0 auto;aspect-ratio:${VB_W}/${VB_H}}
.sheet>img{position:absolute;inset:0;width:100%;height:100%}
.sheet b{position:absolute;font:400 12px/15px var(--font-body);color:hsl(var(--ink));white-space:nowrap;text-shadow:0 1px 0 hsl(var(--bg)),0 -1px 0 hsl(var(--bg)),1px 0 0 hsl(var(--bg)),-1px 0 0 hsl(var(--bg))}
.sheet b i{font-style:normal;font-family:var(--font-display);font-size:15px;font-variant-numeric:lining-nums tabular-nums;color:hsl(var(--pal));margin-right:6px}
.sheet s{position:absolute;text-decoration:none;font:400 11px/14px var(--font-body);letter-spacing:.1em;text-transform:uppercase;color:hsl(var(--muted));background:hsl(var(--bg));padding:0 5px}
.sheet u{position:absolute;text-decoration:none;font:700 11px/14px var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold))}
.sheet em{position:absolute;font-style:normal;font:700 11px/13px var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--muted));text-shadow:0 1px 0 hsl(var(--bg)),0 -1px 0 hsl(var(--bg)),1px 0 0 hsl(var(--bg)),-1px 0 0 hsl(var(--bg))}
.sheet em span{display:block;font-weight:400;font-variant-numeric:lining-nums tabular-nums}
.sheet var{position:absolute;font-style:normal;font:700 11px/14px var(--font-body);color:hsl(var(--muted))}
.stamp{position:absolute;left:0;top:0;font:700 11px/1.5 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));padding:9px 12px;background:hsl(var(--bg));border:1px solid hsl(var(--rule-strong))}
.stamp span{display:block;font-weight:400;color:hsl(var(--muted));font-variant-numeric:lining-nums tabular-nums}
figcaption{margin:var(--space-4) 0 0;font:400 var(--text-sm)/1.5 var(--font-body);color:hsl(var(--line))}
figcaption span{display:block;margin-top:var(--space-2);font-size:var(--text-xs);color:hsl(var(--muted))}
.counts{margin:0 0 var(--space-8)}
.counts div{display:grid;grid-template-columns:3.5rem 1fr;column-gap:var(--space-4);align-items:baseline;padding:var(--space-4) 0;border-top:1px solid hsl(var(--rule))}
.counts dt{font:400 var(--text-2xl)/1 var(--font-display);color:hsl(var(--ink));text-align:right;font-variant-numeric:lining-nums tabular-nums;margin:0}
.counts dd{margin:0}
.counts b{display:block;font:700 var(--text-2xs)/1.4 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold))}
.counts em{display:block;font-style:normal;font:400 var(--text-xs)/1.5 var(--font-body);color:hsl(var(--muted));margin-top:3px}
.lede{font:400 var(--text-sm)/1.5 var(--font-body);color:hsl(var(--muted));margin:0 0 var(--space-4)}
ol{list-style:none;margin:0 0 var(--space-6);padding:0}
li{display:grid;grid-template-columns:2.1rem 1fr;column-gap:var(--space-3);padding:var(--space-5) 0;border-top:1px solid hsl(var(--rule))}
.rank{font:400 var(--text-2xl)/.92 var(--font-display);color:hsl(var(--pal));text-align:right;font-variant-numeric:lining-nums tabular-nums;margin:0;padding-top:.06em}
h3{font:400 var(--text-lg)/var(--leading-snug) var(--font-display);letter-spacing:var(--tracking-display);color:hsl(var(--ink));margin:0 0 var(--space-2)}
.said{font:400 var(--text-sm)/1.45 var(--font-body);color:hsl(var(--line));margin:0 0 var(--space-2);text-indent:-.36em}
.instead{font:400 var(--text-sm)/1.45 var(--font-body);color:hsl(var(--muted));margin:0 0 var(--space-2)}
.facts{font:700 var(--text-2xs)/1.6 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0}
.facts i{font-style:normal;font-weight:400;letter-spacing:.07em;color:hsl(var(--muted))}
.cosign{font:400 var(--text-xs)/1.45 var(--font-body);color:hsl(var(--muted));margin:var(--space-3) 0 0}
.cosign b{color:hsl(var(--line));font-weight:700}
.rest{font:400 var(--text-xs)/1.6 var(--font-body);color:hsl(var(--muted));margin:0 0 var(--space-4)}
.rest b{color:hsl(var(--line));font-weight:400}
.onward{display:inline-flex;align-items:center;min-height:var(--tap);color:hsl(var(--line));font:400 var(--text-sm)/1 var(--font-body);text-decoration:underline;text-decoration-color:hsl(var(--muted));text-underline-offset:4px;transition:color var(--duration-fast) var(--ease-out)}
.onward:hover{color:hsl(var(--ink))}
.history{margin:0 0 var(--space-8)}
.history p{font:400 var(--text-sm)/1.55 var(--font-body);color:hsl(var(--line));margin:0 0 var(--space-3)}
.plate{margin:0 0 var(--space-8)}
.plate img{width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;border-radius:var(--radius-md);background:hsl(var(--surface))}
.plate figcaption{font:400 var(--text-lg)/1.32 var(--font-display);color:hsl(var(--line))}
.cta{margin-top:var(--space-10);padding-top:var(--space-6);border-top:1px solid hsl(var(--rule-strong))}
.cta h2{font:400 var(--text-xl)/1.2 var(--font-display);letter-spacing:var(--tracking-display);margin:var(--space-3) 0;text-wrap:balance}
.cta p{font:400 var(--text-sm)/1.55 var(--font-body);color:hsl(var(--muted));margin:0 0 var(--space-5)}
.cta a{display:inline-flex;align-items:center;min-height:var(--tap);padding:0 var(--space-5);border:1px solid hsl(var(--ember));border-radius:var(--radius-full);color:hsl(var(--ember-ink));font:700 var(--text-xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;text-decoration:none;transition:background var(--duration-fast) var(--ease-out),color var(--duration-fast) var(--ease-out),transform var(--duration-fast) var(--ease-out)}
.cta a:hover{background:hsl(var(--ember));color:hsl(var(--bg))}
.cta a:active{transform:translateY(1px)}
footer{margin-top:var(--space-8);padding-top:var(--space-5);border-top:1px solid hsl(var(--rule));font:400 var(--text-2xs)/1.7 var(--font-body);letter-spacing:.07em;text-transform:uppercase;color:hsl(var(--muted))}
@media (min-width:40rem){
  h1{font-size:var(--text-2xl)}
  .taste{font-size:var(--text-3xl)}
  .wrap{padding-top:var(--space-12)}
  li{grid-template-columns:3rem 1fr}
  .rank{font-size:var(--text-3xl)}
}
@media (prefers-reduced-motion:reduce){*,::before,::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

// ── the sheet ───────────────────────────────────────────────────────────────

/**
 * Marks are a drawing; labels are HTML, absolutely positioned over it.
 *
 * The split is load-bearing rather than a preference. SVG `<text>` inside a
 * 390-unit viewBox renders at 11px on a phone and 14.4px on a wide screen with
 * no way to override it, so the one figure on the page would be the one place
 * whose type is outside the token scale. HTML labels sit at a fixed size, stay
 * selectable, and can be restyled per breakpoint.
 *
 * The drawing is an `<img>` holding a data URI, NOT inline SVG — measured, not
 * assumed. Inline, its forty-odd nodes cost **737 ms of style and layout**
 * under Lighthouse's 4x CPU throttle against 218 ms for the same page with no
 * sheet on it: half a second of the budget spent laying out a picture that
 * never changes. As an image it is decoded once and costs the DOM nothing, and
 * the page carries no `var()` into it — hence `literal: true`.
 *
 * The whole figure is `role="img"` with a written label, so the label layer is
 * presentational to a screen reader — and every fact inside it (the five
 * names, the seventeen, the counts, the finding) is also real prose further
 * down the page. Nothing exists only inside the picture.
 */
function sheetHtml(data: ProfileData): string {
  const map = data.map;
  const at = (l: { leftPct: number; topPct: number }) => `left:${l.leftPct.toFixed(2)}%;top:${l.topPct.toFixed(2)}%`;
  const labels = map.labels
    .map((l) => {
      if (l.kind === "place") {
        return `<b style="${at(l)};--pal:var(--pal-${l.palette})"><i>${l.position}</i>${e(l.text)}</b>`;
      }
      if (l.kind === "contour") return `<s style="${at(l)}">${e(l.text)}</s>`;
      if (l.kind === "campus") return `<u style="${at(l)}">${e(l.text)}</u>`;
      if (l.kind === "north") return `<var style="${at(l)}">${e(l.text)}</var>`;
      if (l.kind === "callout") {
        return `<em style="${at(l)}">${(l.lines ?? [l.text]).map((x) => `<span>${e(x)}</span>`).join("")}</em>`;
      }
      return "";
    })
    .join("");

  const imprint = map.imprint
    ? `<span class="stamp" style="left:${((map.imprint.x / VB_W) * 100).toFixed(2)}%;top:${((map.imprint.y / VB_H) * 100).toFixed(2)}%">${data.counts.places} places<span>${data.counts.visits} ${data.counts.visits === 1 ? "visit" : "visits"}</span></span>`
    : "";

  const alt =
    `A drawn map of the ${numberWord(data.counts.places)} places ${data.author.firstName} has put in order, ` +
    `plotted where they actually stand around the Oval. Five are named; the rest are marked. ` +
    `The dashed rings are five walking minutes apart, and one line runs from the Oval to the first place on the list.`;

  // Percent-encoded rather than base64: the drawing is mostly ASCII, so this
  // is ~25% smaller on the wire, and it stays greppable in `view-source`.
  const drawing =
    "data:image/svg+xml," +
    profileMapSvg(map, { literal: true })
      .replace(/%/g, "%25")
      .replace(/#/g, "%23")
      .replace(/&/g, "%26")
      .replace(/</g, "%3C")
      .replace(/>/g, "%3E")
      .replace(/"/g, "%22");

  return `<div class="sheet" role="img" aria-label="${e(alt)}">
<img src="${drawing}" width="${VB_W}" height="${VB_H}" alt="" decoding="sync" fetchpriority="high">
${imprint}${labels}</div>`;
}

// ── the five ────────────────────────────────────────────────────────────────

function entryHtml(entry: ProfileEntry, first: string): string {
  const facts = [entry.tagLabel ? e(entry.tagLabel) : null, `<i>${entry.walkMin} min from the Oval</i>`]
    .filter(Boolean)
    .join(' <i>·</i> ');

  // Their line if there is one; otherwise what they came for and when — never
  // the place's own marketing sentence, which is not this person speaking.
  const said = entry.line
    ? `<p class="said" data-line>“${smart(entry.line)}”</p>`
    : entry.visit
      ? `<p class="instead" data-line>No note on this one — one ${e(entry.visit.bucket)} in ${e(entry.visit.month)}.</p>`
      : "";

  return `<li data-entry style="--pal:var(--pal-${entry.palette})">
<p class="rank" data-position>${entry.position}</p>
<div>
<h3 data-name>${smart(entry.name)}</h3>
${said}
<p class="facts">${facts}</p>
${cosignLine(entry, first)}
</div>
</li>`;
}

/**
 * Whose lists this place is also on — computed exactly as the share page
 * computes it, and shown with one thing removed: no faces.
 *
 * A public profile is a stronger context than a shared list, and an avatar is
 * a stronger disclosure than a name for somebody who only ever opted their
 * *ranking* into public. Names only, capped at three.
 */
function cosignLine(entry: ProfileEntry, first: string): string {
  if (entry.cosignState === "none") {
    return `<p class="cosign" data-cosign="none">Only on ${e(first)}’s list so far</p>`;
  }
  if (entry.cosignState === "counted") {
    const n = entry.cosignOthers;
    return `<p class="cosign" data-cosign="counted">Cosigned by ${n} other ${n === 1 ? "list" : "lists"}</p>`;
  }
  const names = entry.cosigners.map((c) => `<b>${e(c.display_name)}</b>`);
  const rest = entry.cosignOthers;
  const list = rest || names.length === 1 ? names.join(", ") : names.slice(0, -1).join(", ") + " and " + names.at(-1);
  return `<p class="cosign" data-cosign="named">Cosigned by ${list}${rest ? ` and ${rest} more` : ""}</p>`;
}

// ── the counts ──────────────────────────────────────────────────────────────

function countsHtml(data: ProfileData): string {
  const c = data.counts;
  const rows: Array<[number, string, string]> = [
    [c.places, "places, in order", "Head to head, one pair at a time — never scored, never bought."],
    [c.visits, `${c.visits === 1 ? "visit" : "visits"} logged`, "Each one a reason, a time of day and, sometimes, a line."],
    [
      c.reasons,
      `${c.reasons === 1 ? "reason" : "reasons"} to go`,
      c.reasons === 9
        ? "All nine of them, at least once. Deep work through to first date."
        : `${capitalise(numberWord(c.reasons))} of the nine Cosign knows.`,
    ],
    [
      c.nearestMin,
      `${c.nearestMin === 1 ? "minute" : "minutes"} to the nearest`,
      c.nearestPosition > Math.ceil(c.places / 2)
        ? `Which sits ${ordinal(c.nearestPosition)}. That is not an oversight.`
        : `Which sits ${ordinal(c.nearestPosition)}.`,
    ],
  ];
  return `<dl class="counts">${rows
    .map(
      ([n, label, gloss]) =>
        `<div><dt>${n}</dt><dd><b>${e(label)}</b><em>${smart(gloss)}</em></dd></div>`,
    )
    .join("")}</dl>`;
}

// ── the page ────────────────────────────────────────────────────────────────

export function renderProfilePage(db: DatabaseSync, token: ShareToken, origin = ""): string | null {
  const data = loadProfileData(db, token);
  if (!data) return null;
  return renderProfile(data, origin);
}

export function renderProfile(data: ProfileData, origin = ""): string {
  const a = data.author;
  const first = a.firstName;
  const avatar = a.avatar ? (inlineSvg(a.avatar) ?? a.avatar) : null;
  const ogUrl = `${origin}/og/p/${data.token}`;
  const desc =
    `${a.name}, ${a.school}. ${data.counts.places} places near campus, put in order and drawn where they ` +
    `actually stand.` + (a.signatureOrder ? ` Usually orders ${article(a.signatureOrder)} ${a.signatureOrder}.` : "");

  const lead = data.entries[0];
  const restLine = data.rest.length
    ? `<p class="rest" data-rest>${capitalise(numberWord(data.rest.length))} more are marked on the sheet and not named on it: ` +
      `<b>${data.rest.map((n) => smart(n)).join(", ")}</b>. The order is a different link.</p>`
    : "";
  // The onward link is derived from a LIVE ranking token and addressed by it.
  // Never a username, never a slug: a readable public URL would quietly undo
  // the tokenised addressing this whole model rests on, and revoking the
  // ranking's own link must close this door too.
  const onward = data.rankingToken
    ? `<p><a class="onward" data-onward href="/s/${e(data.rankingToken)}">Read ${e(first)}’s list, in order</a></p>`
    : "";

  const body =
    data.counts.places === 0
      ? // A survey sheet drawn for somebody who has surveyed nothing is a joke
        // at their expense. Empty states are a sentence here, as everywhere.
        `<section data-empty>
<h2 class="slug">Nothing on the map yet</h2>
<p class="taste" style="font-size:var(--text-xl)">${e(first)} hasn’t put anywhere in order.</p>
<p class="lede">When that happens this page draws itself: every place where it actually stands, the walk to each one, and the five at the top in ${e(first)}’s own words.</p>
</section>`
      : `<h2 class="slug">Where ${e(first)} actually goes</h2>
<figure>
${sheetHtml(data)}
<figcaption data-finding>${smart(data.map.finding.sentence)}<span>Five named, ${numberWord(data.rest.length)} more marked. Each ring is another five minutes on foot.</span></figcaption>
</figure>

${data.counts.since ? `<h2 class="head">Since ${e(data.counts.since)}</h2>` : `<h2 class="slug">The count</h2>`}
${countsHtml(data)}

<h2 class="slug">${data.top.length === 5 ? "The five" : `The ${numberWord(data.top.length)} at the top`}, in ${e(first)}’s words</h2>
<p class="lede">Put there one at a time, each one against another. Where there is a line, it is ${e(first)}’s.</p>
<ol>${data.top.map((x) => entryHtml(x, first)).join("")}</ol>
${restLine}${onward}

${
  data.history.length
    ? `<h2 class="slug" style="margin-top:var(--space-10)">The order has a history</h2>
<p class="lede">A ranking is an argument you keep having.</p>
<div class="history">${data.history.map((s) => `<p>${smart(s)}</p>`).join("")}</div>`
    : ""
}

${
  lead?.photo
    ? `<figure class="plate">
<img src="${e(lead.photo)}" width="560" height="350" alt="" loading="lazy" decoding="async">
<figcaption>${smart(lead.name)}. The first place on the list, ${numberWord(lead.walkMin)} minutes away, and the far end of the line on the sheet.</figcaption>
</figure>`
    : ""
}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(a.name)} — Cosign</title>
<meta name="description" content="${e(desc)}">
<!-- Unlisted means unlisted (decision 12). A search engine that has indexed
     this URL would outlive any revocation. -->
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#14100E">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Cosign">
<meta property="og:title" content="${e(`${a.name} · one person’s campus`)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:image" content="${e(ogUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(`${a.name}'s campus on Cosign: ${data.counts.places} places, mapped`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${e(ogUrl)}">
<style>${tokensCss({ fonts: false })}${PAGE_CSS.replace(/\n\s*/g, "")}</style>
</head>
<body>
<main class="wrap">
<p class="kicker">Cosign · one person’s campus</p>
<header data-author>
<div class="who">
${avatar ? `<img src="${e(avatar)}" width="48" height="48" alt="">` : ""}
<div>
<h1>${e(a.name)}</h1>
<p class="where">${e(a.school)} · @${e(a.username)}</p>
</div>
</div>
${a.tasteLine ? `<p class="taste" data-taste>${smart(a.tasteLine)}</p>` : ""}
${
  a.signatureOrder
    ? `<dl class="usual" data-usual><div><dt>Usually orders</dt><dd>${smart(capitalise(a.signatureOrder))}${
        // "If you're buying, that's the one" is a joke about a drink, and it
        // lands badly on Noah's "Still deciding". A real order names what is
        // in it, so the comma is the test — and when there isn't one the
        // value stands on its own, which is the honest version anyway.
        /,/.test(a.signatureOrder) ? "<span>If you’re buying, that’s the one.</span>" : ""
      }</dd></div></dl>`
    : ""
}
</header>
${body}
<section class="cta" data-cta>
<p class="kicker" style="border:0;padding:0;margin-bottom:0">Make your own</p>
<h2>Your campus is a different shape.</h2>
<p>Rank the places you actually go — this one or that one, one tap at a time — and the sheet draws itself. No stars to argue with, and nobody can buy their way onto the map.</p>
<a href="/onboarding">Start your list</a>
</section>
<footer>Cosign · ${e(a.school)}<br>${e(first)} can turn this link off at any time.</footer>
</main>
<!-- The faces are declared here, after the content, on purpose. This page's
     first paint is TEXT, and \`font-display: swap\` means that text never waits
     on the network — so the fonts have no business on the critical path, and
     discovering them after the first paint is what keeps them off it. See
     server/pages/tokens.ts. -->
<style>${fontFaceCss()}</style>
</body>
</html>`;
}
