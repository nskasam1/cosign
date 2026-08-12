import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";

export const config = { runtime: "edge" };

// Phase 2 — the actual growth-loop surface. Hand-templated HTML instead of
// React SSR: this list is read-only, so there's no interactivity worth
// paying a hydration cost for. Goal is sub-1s on bad wifi — minimal
// markup, no client JS beyond what's needed for lazy-loaded photos, no
// auth check, no "open in app" interstitial. The in-app SPA route at
// /:username (src/pages/Profile.tsx) renders the same data for logged-in
// viewing/editing; this is the one that should actually get shared.
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const username = url.pathname.split("/").pop() ?? "";

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Share route not configured yet — needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.", { status: 503 });
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey);

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .ilike("username", username)
    .maybeSingle();

  if (!profile) {
    return new Response("Not found", { status: 404 });
  }

  const { data: elo } = await admin.rpc("compute_user_elo", { p_user_id: profile.id });
  const ranked = (elo ?? []).sort((a, b) => b.elo_score - a.elo_score);
  const shopIds = ranked.map((e) => e.shop_id);

  const shopsRes = shopIds.length ? await admin.from("shops").select("*").in("id", shopIds) : null;
  const shopById = new Map((shopsRes?.data ?? []).map((s) => [s.id, s]));

  const photosRes = shopIds.length
    ? await admin.from("shop_photos").select("shop_id, url").in("shop_id", shopIds)
    : null;
  const photoByShop = new Map<string, string>();
  for (const p of photosRes?.data ?? []) if (!photoByShop.has(p.shop_id)) photoByShop.set(p.shop_id, p.url);

  const tagsRes = shopIds.length
    ? await admin.from("shop_intent_tag_tallies").select("shop_id, intent_tag").in("shop_id", shopIds)
    : null;
  const tagRows = tagsRes?.data ?? [];
  const tagsByShop = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByShop.get(t.shop_id) ?? [];
    list.push(t.intent_tag);
    tagsByShop.set(t.shop_id, list);
  }
  const allTags = [...new Set(tagRows.map((t) => t.intent_tag))];

  const rows = ranked
    .map((e) => shopById.get(e.shop_id))
    .filter((shop): shop is NonNullable<typeof shop> => Boolean(shop))
    .map((shop) => {
      const tags = tagsByShop.get(shop.id) ?? [];
      return `
        <a class="row" href="/shop/${shop.id}" data-tags="${tags.join(",")}">
          <img loading="lazy" src="${photoByShop.get(shop.id) ?? "/placeholder.svg"}" alt="" />
          <div class="row-text">
            <div class="row-name">${escapeHtml(shop.name)}</div>
            <div class="row-address">${escapeHtml(shop.address)}</div>
            ${tags.length ? `<div class="row-tags">${tags.map((t) => `<span>${escapeHtml(t.replace(/_/g, " "))}</span>`).join("")}</div>` : ""}
          </div>
        </a>`;
    })
    .join("");

  const chips = allTags
    .map((tag) => `<button class="chip" data-filter="${tag}">${escapeHtml(String(tag).replace(/_/g, " "))}</button>`)
    .join("");

  const title = `${profile.display_name || profile.username} on Cosign`;
  const description = profile.one_line_taste_summary || `Ranked recommendations from @${profile.username}.`;
  const ogImage = `${url.origin}/api/og/${encodeURIComponent(username)}`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #141618; color: #e8e0d5; font-family: -apple-system, sans-serif; }
  .header { padding: 32px 20px 16px; }
  .header .name { font-size: 28px; font-weight: 900; margin: 0; }
  .header .handle { color: #9ca3af; font-size: 14px; margin-top: 2px; }
  .header .summary { margin-top: 10px; font-size: 15px; }
  .list { display: flex; flex-direction: column; gap: 8px; padding: 0 20px 24px; }
  .row { display: flex; gap: 12px; align-items: center; text-decoration: none; color: inherit; background: #1a1c1e; border-radius: 16px; padding: 10px; }
  .row img { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; background: #2d3035; }
  .row-name { font-weight: 600; font-size: 15px; }
  .row-address { font-size: 12px; color: #9ca3af; }
  .row-tags { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
  .row-tags span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; background: #2d3035; color: #9ca3af; padding: 2px 8px; border-radius: 999px; }
  .chips { display: flex; gap: 8px; padding: 0 20px 16px; overflow-x: auto; }
  .chip { flex-shrink: 0; font-size: 12px; font-weight: 600; text-transform: capitalize; background: #1a1c1e; color: #9ca3af; border: 1px solid #2d3035; border-radius: 999px; padding: 6px 14px; }
  .chip.active { background: #c8a96e; color: #141618; border-color: #c8a96e; }
  .cta { display: block; text-align: center; padding: 20px; color: #9ca3af; text-decoration: none; font-size: 14px; }
</style>
</head>
<body>
  <div class="header">
    <p class="name">${escapeHtml(profile.display_name || profile.username)}</p>
    <p class="handle">@${escapeHtml(profile.username)}</p>
    ${profile.one_line_taste_summary ? `<p class="summary">${escapeHtml(profile.one_line_taste_summary)}</p>` : ""}
  </div>
  ${chips ? `<div class="chips">${chips}</div>` : ""}
  <div class="list">
    ${rows || `<p style="padding:0 4px;color:#9ca3af;font-size:14px;">Nothing ranked yet.</p>`}
  </div>
  <a class="cta" href="/">Make your own on Cosign →</a>
  ${
    chips
      ? `<script>
    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const tag = chip.dataset.filter;
        const nowActive = !chip.classList.contains("active");
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        if (nowActive) chip.classList.add("active");
        document.querySelectorAll(".row").forEach((row) => {
          const tags = (row.dataset.tags || "").split(",");
          row.style.display = !nowActive || tags.includes(tag) ? "flex" : "none";
        });
      });
    });
  </script>`
      : ""
  }
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
