// Phase 5.3 — semester recap card. Per the brief this ships automatically
// the last week of classes, not as a manual export — so this is meant to
// run on a schedule (`supabase functions schedule`, or a Vercel Cron
// hitting this function's URL) once a real project exists to schedule
// against. Not wired to a schedule yet.
//
// Generates the same "ranked list + OG image" shape as api/s/[username].ts
// and api/og/[username].tsx, just for a rolling window (the semester)
// instead of all-time, and pushed as a notification rather than pulled.
//
// Needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase function env,
// separate from the Vercel-side env vars the api/ functions use).

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Not configured yet", { status: 503 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: profiles } = await admin.from("profiles").select("id, username");

  for (const profile of profiles ?? []) {
    const { data: elo } = await admin.rpc("compute_user_elo", { p_user_id: profile.id });
    if (!elo || elo.length === 0) continue;

    // TODO once scheduled for real: render the recap OG image (reuse the
    // api/og/[username].tsx layout, semester-scoped), upload it, and
    // insert a notification row pointing at it. Left as a stub — this
    // needs the OG rendering to live somewhere both Vercel and this Deno
    // function can call, which is a real design decision, not a default.
    await admin.from("notifications").insert({
      user_id: profile.id,
      type: "semester_recap",
      payload: { shop_count: elo.length },
    });
  }

  return new Response("ok");
});
