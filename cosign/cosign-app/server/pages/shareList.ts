// SSR public share page — hand-templated HTML, no client framework, no auth
// (decision 2). This Phase 1 version proves the local pipeline end-to-end:
// token → ranked list → HTML. Phase 2 replaces the styling with the
// committed design tokens, adds the OG image, and takes the perf gate.

import type { DatabaseSync } from "node:sqlite";
import type { IntentTag, ShareToken } from "../../src/types/cosign.ts";
import { INTENT_TAG_LABELS } from "../../src/types/cosign.ts";
import * as social from "../repo/social.ts";
import * as shopsRepo from "../repo/shops.ts";
import * as rank from "../repo/rank.ts";
import * as listsRepo from "../repo/lists.ts";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ShareEntry {
  position: number;
  name: string;
  photo: string | null;
  line: string | null; // one honest line (author's own log line if any)
  tags: IntentTag[];
  cosign_count: number;
}

export interface ShareData {
  authorName: string;
  authorAvatar: string | null;
  authorSchool: string;
  tasteLine: string | null;
  title: string;
  entries: ShareEntry[];
}

export function loadShareData(db: DatabaseSync, token: ShareToken): ShareData | null {
  const author = social.userById(db, token.user_id);
  if (!author) return null;
  const school = (db.prepare("SELECT name FROM schools WHERE id = ?").get(author.school_id) as { name: string } | undefined)?.name ?? "";

  // A token is scoped to exactly one surface. 'list' renders that list;
  // 'ranking' renders the canonical ranking. A 'profile' token belongs to
  // /p/:token (Phase 5A) and must never fall through to the whole ranking.
  let shopIds: string[];
  let title: string;
  if (token.kind === "list") {
    if (!token.list_id) return null;
    const list = listsRepo.listById(db, token.list_id);
    if (!list) return null;
    shopIds = listsRepo.itemsOf(db, token.list_id).map((i) => i.shop_id);
    title = list.title;
  } else if (token.kind === "ranking") {
    shopIds = rank.rankedShopIds(db, token.user_id);
    title = `${author.display_name.split(" ")[0]}'s campus coffee, ranked`;
  } else {
    return null;
  }

  const entries: ShareEntry[] = shopIds.map((shopId, i) => {
    const shop = shopsRepo.shopById(db, shopId);
    const photos = shopsRepo.photosOf(db, shopId);
    // the author's own most recent line about this place, if they wrote one
    const line = (db
      .prepare(
        "SELECT line FROM logs WHERE user_id = ? AND shop_id = ? AND line IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(token.user_id, shopId) as { line: string } | undefined)?.line ?? shop?.one_liner ?? null;
    const tags = (db
      .prepare(
        "SELECT DISTINCT intent_tag FROM logs WHERE user_id = ? AND shop_id = ? LIMIT 3",
      )
      .all(token.user_id, shopId) as unknown as Array<{ intent_tag: IntentTag }>).map((r) => r.intent_tag);
    const cosigns = (db
      .prepare("SELECT count(*) n FROM ranking_entries WHERE shop_id = ?")
      .get(shopId) as { n: number }).n;
    return {
      position: i + 1,
      name: shop?.name ?? shopId,
      photo: photos[0]?.path ?? null,
      line,
      tags,
      cosign_count: cosigns,
    };
  });

  return {
    authorName: author.display_name,
    authorAvatar: author.avatar,
    authorSchool: school,
    tasteLine: author.taste_line,
    title,
    entries,
  };
}

export function renderSharePage(db: DatabaseSync, token: ShareToken): string | null {
  const data = loadShareData(db, token);
  if (!data) return null;
  const allTags = [...new Set(data.entries.flatMap((e) => e.tags))];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)} — Cosign</title>
<meta name="description" content="${escapeHtml(data.authorName)}'s ranked list on Cosign">
<!-- unlisted: shared by link, never indexed (decision 12) -->
<meta name="robots" content="noindex, nofollow">
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #141618; color: #e8e0d5; }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px 64px; }
  header { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
  header img { width: 56px; height: 56px; border-radius: 50%; }
  h1 { font-size: 22px; margin: 16px 0 20px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; }
  .chips button { background: #1a1c1e; color: #e8e0d5; border: 1px solid #2d3035; border-radius: 999px; padding: 8px 14px; min-height: 44px; }
  .chips button[aria-pressed="true"] { border-color: #c8a96e; color: #c8a96e; }
  ol { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid #2d3035; }
  li img, li .noimg { width: 72px; height: 72px; border-radius: 12px; object-fit: cover; flex: none; }
  li .noimg { background: #1a1c1e; border: 1px solid #2d3035; display: grid; place-items: center; color: #c8a96e; font-size: 20px; }
  .pos { color: #c8a96e; font-weight: 700; width: 24px; flex: none; padding-top: 2px; }
  .line { color: #9ca3af; margin: 4px 0 6px; font-size: 14px; }
  .tags { color: #c8a96e; font-size: 12px; }
  .count { color: #9ca3af; font-size: 12px; margin-top: 4px; }
  footer { margin-top: 32px; text-align: center; }
  footer a { color: #c8a96e; }
</style>
</head>
<body>
<main>
  <header>
    ${data.authorAvatar ? `<img src="${escapeHtml(data.authorAvatar)}" alt="">` : ""}
    <div>
      <strong>${escapeHtml(data.authorName)}</strong><br>
      <small>${escapeHtml(data.authorSchool)}</small>
      ${data.tasteLine ? `<div class="line">${escapeHtml(data.tasteLine)}</div>` : ""}
    </div>
  </header>
  <h1>${escapeHtml(data.title)}</h1>
  <div class="chips" role="group" aria-label="Filter by intent">
    ${allTags
      .map(
        (t) =>
          `<button data-tag="${escapeHtml(t)}" aria-pressed="false">${escapeHtml(INTENT_TAG_LABELS[t] ?? t)}</button>`,
      )
      .join("")}
  </div>
  <ol>
    ${data.entries
      .map(
        (e) => `<li data-tags="${escapeHtml(e.tags.join(" "))}">
      <span class="pos">${e.position}</span>
      ${e.photo ? `<img src="${escapeHtml(e.photo)}" alt="" loading="lazy">` : `<span class="noimg">☕</span>`}
      <div>
        <strong>${escapeHtml(e.name)}</strong>
        ${e.line ? `<div class="line">${escapeHtml(e.line)}</div>` : ""}
        ${e.tags.length ? `<div class="tags">${e.tags.map((t) => escapeHtml(INTENT_TAG_LABELS[t] ?? t)).join(" · ")}</div>` : ""}
        <div class="count">cosigned by ${e.cosign_count}</div>
      </div>
    </li>`,
      )
      .join("")}
  </ol>
  <footer><a href="/onboarding">Make your own list on Cosign</a></footer>
</main>
<script>
  document.querySelectorAll(".chips button").forEach((b) => {
    b.addEventListener("click", () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      document.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", String(on));
      document.querySelectorAll("ol li").forEach((li) => {
        li.style.display = !on || (li.dataset.tags || "").split(" ").includes(b.dataset.tag) ? "" : "none";
      });
    });
  });
</script>
</body>
</html>`;
}

export function renderTombstone(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link no longer shared — Cosign</title>
<style>body{margin:0;font-family:system-ui;background:#141618;color:#e8e0d5;display:grid;place-items:center;min-height:100vh}main{text-align:center;padding:24px}</style>
</head><body><main><h1>This list isn't shared anymore</h1><p>The person who shared it turned the link off.</p></main></body></html>`;
}
