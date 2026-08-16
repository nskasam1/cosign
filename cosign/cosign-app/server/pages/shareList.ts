// The public share page — the product's hero surface (brief, decision 2).
// Hand-templated HTML: no framework, no stylesheet request, no bundle, no
// auth. The token in the URL is the authorisation and the whole session.
//
// Design: "broadside" — an editorial ranked column. Rank numerals hang in
// the margin in the display face, tinted with the same palette that painted
// that place's photograph, so the list carries a colour rhythm taken from
// the places themselves. Tokens come from src/design/tokens.css; nothing
// here invents a colour, size, or duration of its own.

import type { DatabaseSync } from "node:sqlite";
import type { ShareToken } from "../../src/types/cosign.ts";
import { loadShareData, inlineSvg, type ShareData, type ShareEntry } from "./shareData.ts";
import { tokensCss } from "./tokens.ts";
import { article } from "../../src/lib/placeCopy.ts";

export { loadShareData } from "./shareData.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;

/** Typographer's quotes and dashes — the copy is written, not printf'd. */
function smart(s: string): string {
  return e(s)
    .replace(/(\w)&#39;(\w)/g, "$1’$2")
    .replace(/&#39;/g, "’")
    .replace(/ - /g, " — ");
}

const PAGE_CSS = `
*,::before,::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:hsl(var(--bg));color:hsl(var(--ink));font:400 var(--text-base)/var(--leading-body) var(--font-body);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
img{display:block;max-width:100%}
::selection{background:hsl(var(--ember)/.32)}
:focus-visible{outline:2px solid hsl(var(--ember));outline-offset:3px}
.wrap{max-width:37.25rem;margin:0 auto;padding:var(--space-6) var(--gutter) var(--space-10)}
.kicker{font:700 var(--text-2xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0 0 var(--space-4);padding-bottom:var(--space-4);border-bottom:1px solid hsl(var(--rule))}
h1{font:400 var(--text-3xl)/var(--leading-tight) var(--font-display);letter-spacing:var(--tracking-display);margin:var(--space-5) 0;text-wrap:balance}
.author{display:flex;align-items:center;gap:var(--space-3);margin:0 0 var(--space-4)}
.author img{width:48px;height:48px;border-radius:var(--radius-full);flex:none;background:hsl(var(--surface))}
.who{font:700 var(--text-base)/1.2 var(--font-body);margin:0}
.where{font:400 var(--text-xs)/1.35 var(--font-body);color:hsl(var(--muted));margin:3px 0 0}
.taste{font:400 var(--text-lg)/1.32 var(--font-display);color:hsl(var(--line));margin:0 0 var(--space-5);text-indent:-.38em}
.meta{font:400 var(--text-xs)/1.6 var(--font-body);color:hsl(var(--muted));margin:0;padding-top:var(--space-4);border-top:1px solid hsl(var(--rule))}
.meta b{color:hsl(var(--line));font-weight:400}
.chips{display:flex;gap:var(--space-2);overflow-x:auto;scrollbar-width:none;margin:var(--space-5) calc(var(--gutter)*-1) 0;padding:0 var(--gutter) var(--space-1)}
.chips::-webkit-scrollbar{display:none}
.chips button{flex:none;min-height:var(--tap);padding:0 var(--space-4);border:1px solid hsl(var(--rule-strong));border-radius:var(--radius-full);background:hsl(var(--surface));color:hsl(var(--line));font:400 var(--text-xs)/1 var(--font-body);white-space:nowrap;cursor:pointer;transition:background var(--duration-fast) var(--ease-out),border-color var(--duration-fast) var(--ease-out),color var(--duration-fast) var(--ease-out)}
.chips button i{font-style:normal;color:hsl(var(--muted));margin-left:.45em;font-variant-numeric:tabular-nums}
.chips button[aria-pressed=true]{background:hsl(var(--ember));border-color:hsl(var(--ember));color:hsl(var(--bg));font-weight:700}
.chips button[aria-pressed=true] i{color:hsl(var(--bg))}
.status{font:700 var(--text-2xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--muted));margin:var(--space-5) 0 0}
ol{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:2.1rem 1fr;column-gap:var(--space-3);padding:var(--space-5) 0;border-top:1px solid hsl(var(--rule))}
li[hidden]{display:none}
li:first-child{border-top:0;padding-top:var(--space-4)}
.rank{grid-row:span 1;font:400 var(--text-2xl)/.92 var(--font-display);color:hsl(var(--pal));text-align:right;font-variant-numeric:lining-nums tabular-nums;margin:0;padding-top:.06em}
.body{min-width:0;overflow:hidden}
.shot,.plate{float:right;width:84px;height:84px;border-radius:var(--radius-sm);margin:.15rem 0 var(--space-2) var(--space-4)}
.shot{object-fit:cover;background:hsl(var(--surface))}
.plate{display:grid;place-items:center;background:hsl(var(--plate));border:1px solid hsl(var(--pal)/.24);color:hsl(var(--pal));font:400 1.6rem/1 var(--font-display);letter-spacing:-.02em}
.name{font:400 var(--text-lg)/var(--leading-snug) var(--font-display);letter-spacing:var(--tracking-display);margin:0 0 var(--space-2)}
.line{font:400 var(--text-sm)/1.45 var(--font-body);color:hsl(var(--line));margin:0 0 var(--space-2)}
.facts{font:700 var(--text-2xs)/1.6 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0}
.facts i{font-style:normal;font-weight:400;letter-spacing:.07em;color:hsl(var(--muted))}
.cosign{clear:right;display:flex;align-items:center;gap:var(--space-2);font:400 var(--text-xs)/1.45 var(--font-body);color:hsl(var(--muted));margin:var(--space-3) 0 0}
.faces{display:flex;flex:none}
.faces img{width:22px;height:22px;border-radius:var(--radius-full);border:1.5px solid hsl(var(--bg));background:hsl(var(--surface))}
.faces img+img{margin-left:-8px}
.cosign b{color:hsl(var(--line));font-weight:700}
.lead .shot{grid-column:1/-1;float:none;width:100%;height:auto;aspect-ratio:16/10;margin:0 0 var(--space-4);border-radius:var(--radius-md)}
.lead .rank{font-size:var(--text-4xl);line-height:.85}
.lead .name{font-size:var(--text-xl)}
.cta{margin-top:var(--space-10);padding-top:var(--space-6);border-top:1px solid hsl(var(--rule-strong))}
.cta h2{font:400 var(--text-xl)/1.2 var(--font-display);letter-spacing:var(--tracking-display);margin:var(--space-3) 0;text-wrap:balance}
.cta p{font:400 var(--text-sm)/1.55 var(--font-body);color:hsl(var(--muted));margin:0 0 var(--space-5)}
.cta a{display:inline-flex;align-items:center;min-height:var(--tap);padding:0 var(--space-5);border:1px solid hsl(var(--ember));border-radius:var(--radius-full);color:hsl(var(--ember-ink));font:700 var(--text-xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;text-decoration:none;transition:background var(--duration-fast) var(--ease-out),color var(--duration-fast) var(--ease-out)}
.cta a:hover{background:hsl(var(--ember));color:hsl(var(--bg))}
footer{margin-top:var(--space-8);padding-top:var(--space-5);border-top:1px solid hsl(var(--rule));font:400 var(--text-2xs)/1.7 var(--font-body);letter-spacing:.07em;text-transform:uppercase;color:hsl(var(--muted))}
@media (min-width:40rem){
  h1{font-size:var(--text-4xl)}
  .wrap{padding-top:var(--space-12)}
  .shot,.plate{width:104px;height:104px}
  li{grid-template-columns:3rem 1fr}
  .rank{font-size:var(--text-3xl)}
}
/* On a wide screen the reading column stays a reading column — only the
   lead photograph bleeds past it, the way a plate does in print. */
@media (min-width:64rem){
  .lead .shot{width:calc(100% + 7rem);max-width:none;margin-left:-3.5rem;aspect-ratio:2.4/1}
}
@media (prefers-reduced-motion:reduce){*,::before,::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

// ~700 bytes: the chips are the only interactive thing on the page.
const PAGE_JS = `(function(){
var chips=[].slice.call(document.querySelectorAll('[data-chip]'));
var all=document.querySelector('[data-chip-all]');
var items=[].slice.call(document.querySelectorAll('[data-entry]'));
var status=document.querySelector('[data-count]');
function apply(tag){
  var n=0;
  items.forEach(function(li){
    var show=!tag||(' '+li.getAttribute('data-tags')+' ').indexOf(' '+tag+' ')>-1;
    li.hidden=!show;if(show)n++;
  });
  all.setAttribute('aria-pressed',String(!tag));
  chips.forEach(function(c){c.setAttribute('aria-pressed',String(c.getAttribute('data-chip')===tag))});
  status.textContent=tag?('Showing '+n+' of '+items.length):('All '+items.length+', in order');
}
chips.forEach(function(c){c.addEventListener('click',function(){
  apply(c.getAttribute('aria-pressed')==='true'?null:c.getAttribute('data-chip'));
})});
all.addEventListener('click',function(){apply(null)});
})();`;

function plateOrPhoto(entry: ShareEntry, lead: boolean): string {
  if (entry.photo) {
    const inline = lead ? inlineSvg(entry.photo, { grain: false }) : null;
    const src = inline ?? entry.photo;
    const dims = lead ? 'width="560" height="350"' : 'width="84" height="84"';
    const load = lead ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
    return `<img class="shot" src="${e(src)}" ${dims} alt="" ${load}>`;
  }
  // No photograph is a first-class state, not a gap: the place's initials
  // set in the display face on its own palette — the same treatment its
  // photograph would have used.
  return `<span class="plate" data-nophoto aria-hidden="true">${e(entry.initials)}</span>`;
}

function cosignLine(entry: ShareEntry, authorFirst: string): string {
  if (entry.cosignState === "none") {
    return `<p class="cosign" data-cosign="none">Only on ${e(authorFirst)}’s list so far</p>`;
  }
  if (entry.cosignState === "counted") {
    const n = entry.cosignOthers;
    return `<p class="cosign" data-cosign="counted">Cosigned by ${n} other ${n === 1 ? "list" : "lists"}</p>`;
  }
  const faces = entry.cosigners
    .filter((c) => c.avatar)
    .map((c) => `<img src="${e(c.avatar!)}" width="22" height="22" alt="" loading="lazy" decoding="async">`)
    .join("");
  const names = entry.cosigners.map((c) => `<b>${e(c.display_name)}</b>`);
  const rest = entry.cosignOthers;
  // "A and B" reads better than "A, B" — but only one "and" per sentence, so
  // a trailing count takes the conjunction and the names fall back to commas.
  const list = rest || names.length === 1 ? names.join(", ") : names.slice(0, -1).join(", ") + " and " + names.at(-1);
  const tail = rest ? ` and ${rest} more` : "";
  return `<p class="cosign" data-cosign="named">${faces ? `<span class="faces">${faces}</span>` : ""}<span>Cosigned by ${list}${tail}</span></p>`;
}

function entryHtml(entry: ShareEntry, authorFirst: string): string {
  const lead = entry.position === 1;
  const facts = [
    ...entry.tagLabels.map((l) => e(l)),
    ...entry.facts.map((f) => `<i>${e(f)}</i>`),
  ].join(' <i>·</i> ');
  return `<li${lead ? ' class="lead"' : ""} data-entry data-tags="${e(entry.tags.join(" "))}" style="--pal:var(--pal-${entry.palette});--plate:var(--plate-${entry.palette})">
${lead ? plateOrPhoto(entry, true) : ""}<p class="rank" data-position>${entry.position}</p>
<div class="body">${lead ? "" : plateOrPhoto(entry, false)}
<h2 class="name" data-name>${smart(entry.name)}</h2>
${entry.line ? `<p class="line" data-line>${smart(entry.line)}</p>` : ""}
${facts ? `<p class="facts" data-taglist>${facts}</p>` : ""}
${cosignLine(entry, authorFirst)}</div>
</li>`;
}

export function renderSharePage(db: DatabaseSync, token: ShareToken, origin = ""): string | null {
  const data = loadShareData(db, token);
  if (!data) return null;
  return renderShare(data, origin);
}

export function renderShare(data: ShareData, origin = ""): string {
  const a = data.author;
  const avatar = a.avatar ? (inlineSvg(a.avatar) ?? a.avatar) : null;
  const ogUrl = `${origin}/og/s/${data.token}`;
  const desc = a.tasteLine
    ? `${a.name} ranked ${data.entries.length} places near ${a.school}. ${a.tasteLine}`
    : `${a.name} ranked ${data.entries.length} places near ${a.school}.`;
  const updated = data.updatedAt
    ? new Date(data.updatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const meta = [
    `<b>${data.entries.length} places</b>, ranked head to head — never scored, never bought`,
    a.signatureOrder ? `usually orders ${article(a.signatureOrder)} <b>${e(a.signatureOrder)}</b>` : null,
    updated ? `last put in order ${e(updated)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${e(data.title)} — Cosign</title>
<meta name="description" content="${e(desc)}">
<!-- Unlisted means unlisted. A share link is the per-list opt-in (decision
     12); a search engine indexing it would outlive any revocation. -->
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#14100E">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Cosign">
<meta property="og:title" content="${e(data.title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:image" content="${e(ogUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${e(`${a.name}'s ranked list on Cosign`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${e(ogUrl)}">
<style>${tokensCss()}${PAGE_CSS.replace(/\n\s*/g, "")}</style>
</head>
<body>
<main class="wrap">
<p class="kicker">Cosign · one person’s list</p>
<h1>${smart(data.title)}</h1>
<header data-author>
<div class="author">
${avatar ? `<img src="${e(avatar)}" width="48" height="48" alt="">` : ""}
<div>
<p class="who">${e(a.name)}</p>
<p class="where">${e(a.school)} · @${e(a.username)}</p>
</div>
</div>
${a.tasteLine ? `<p class="taste">“${smart(a.tasteLine)}”</p>` : ""}
<p class="meta">${meta}</p>
</header>
<div class="chips" role="group" aria-label="Filter the list by what you came for">
<button type="button" data-chip-all aria-pressed="true">Everything<i>${data.entries.length}</i></button>
${data.tagCounts
  .map(
    (t) =>
      `<button type="button" data-chip="${e(t.tag)}" aria-pressed="false">${e(t.label)}<i>${t.count}</i></button>`,
  )
  .join("")}
</div>
<p class="status" data-count role="status">All ${data.entries.length}, in order</p>
<ol>
${data.entries.map((x) => entryHtml(x, a.firstName)).join("\n")}
</ol>
<section class="cta" data-cta>
<p class="kicker" style="border:0;padding:0;margin-bottom:0">Make your own</p>
<h2>${data.entries.length} places, put in order by one person who actually went.</h2>
<p>Rank yours the same way — this place or that one, one tap at a time — and send the link. No stars to argue with, and nobody can buy their way up.</p>
<a href="/onboarding">Start your list</a>
</section>
<footer>Cosign · ${e(a.school)}<br>${e(a.firstName)} can turn this link off at any time.</footer>
</main>
<script>${PAGE_JS.replace(/\n/g, "")}</script>
</body>
</html>`;
}

/**
 * A revoked link, for either public surface. One function with one noun
 * swapped, so the two cannot drift — and neither variant names the person,
 * their school, or anything that was on the page. A tombstone that leaks the
 * content is not a tombstone.
 */
export function renderTombstone(kind: "list" | "profile" = "list"): string {
  const what = kind === "profile" ? "This page" : "This list";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This link isn’t shared anymore — Cosign</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#14100E">
<style>${tokensCss()}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:hsl(var(--bg));color:hsl(var(--ink));font:400 var(--text-base)/var(--leading-body) var(--font-body)}main{max-width:24rem;padding:var(--space-6);text-align:center}p.k{font:700 var(--text-2xs)/1 var(--font-body);letter-spacing:var(--tracking-caps);text-transform:uppercase;color:hsl(var(--gold));margin:0 0 var(--space-4)}h1{font:400 var(--text-2xl)/1.15 var(--font-display);letter-spacing:var(--tracking-display);margin:0 0 var(--space-3)}p{color:hsl(var(--muted));margin:0;font-size:var(--text-sm)}</style>
</head>
<body><main>
<p class="k">Cosign</p>
<h1>${what} isn’t shared anymore</h1>
<p>The person who sent it turned the link off. That’s the whole point of the link — it was theirs to take back.</p>
</main></body>
</html>`;
}
