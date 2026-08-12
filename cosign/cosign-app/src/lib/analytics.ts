import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

// Phase 5.4 — instrumentation from day one, even with no dashboard yet.
// The brief names one metric explicitly as the real signal for whether
// the retention loop works: weekly returning users who logged nothing.
// That's computed later from these raw events (a query over `rankings`
// vs. distinct users active per week), not tracked as its own event here.
export function track(event: string, props?: Record<string, Json>) {
  supabase.auth.getUser().then(({ data }) => {
    supabase.from("analytics_events").insert({
      user_id: data.user?.id ?? null,
      event,
      props: props ?? null,
    });
  });
}
