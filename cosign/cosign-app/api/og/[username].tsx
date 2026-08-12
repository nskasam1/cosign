import { ImageResponse } from "@vercel/og";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";

export const config = { runtime: "edge" };

// Phase 2 — the OG image is the actual first impression for shared links
// (iMessage/Instagram DM previews render this, not the app). Uses the
// service role key to read past RLS server-side — same pattern as
// api/s/[username].ts. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
// which aren't set yet (waiting on the new Supabase project).
export default async function handler(req: Request) {
  const url = new URL(req.url);
  const username = url.pathname.split("/").pop() ?? "";

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("OG image generation not configured yet", { status: 503 });
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
  const topShopIds = (elo ?? [])
    .sort((a, b) => b.elo_score - a.elo_score)
    .slice(0, 3)
    .map((e) => e.shop_id);

  const { data: topShops } = topShopIds.length
    ? await admin.from("shops").select("name").in("id", topShopIds)
    : { data: [] };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#141618",
          color: "#e8e0d5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.7 }}>@{profile.username} on Cosign</div>
        <div style={{ fontSize: 56, fontWeight: 900, marginTop: 12 }}>
          {profile.display_name || profile.username}'s ranked list
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 40 }}>
          {(topShops ?? []).map((shop, i) => (
            <div key={shop.name} style={{ fontSize: 34, display: "flex", gap: 16 }}>
              <span style={{ opacity: 0.5 }}>{i + 1}</span>
              <span>{shop.name}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
