import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, MapPin, Swords, Share2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { currentSemesterPhase } from "@/lib/semester";
import type { Shop } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// "near me, open now, has outlets" answered in zero taps from home. Real
// open-hours/outlet filtering needs shop_amenities + hours joined in; this
// does the distance half now and stubs the rest until real shop data +
// amenity fields are seeded.
const useNearestShop = () => {
  const [nearest, setNearest] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("shops").select("*");
      const shops = (data ?? []) as Shop[];
      if (shops.length === 0 || !navigator.geolocation) { setLoading(false); return; }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const withDistance = shops.map((s) => ({
            shop: s,
            distance: Math.hypot(s.lat - latitude, s.lng - longitude),
          }));
          withDistance.sort((a, b) => a.distance - b.distance);
          setNearest(withDistance[0]?.shop ?? null);
          setLoading(false);
        },
        () => setLoading(false),
        { timeout: 8000 }
      );
    })();
  }, []);

  return { nearest, loading };
};

const Home = () => {
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { nearest, loading: nearestLoading } = useNearestShop();
  // Phase 5.2 — semester phase decides what leads the home screen: week
  // one surfaces campus-wide discovery (nobody has a personal list yet),
  // mid-semester and finals lead with the near-me/open-late/outlets card.
  const phase = currentSemesterPhase();

  return (
    <div className="min-h-screen pb-10">
      <div className="flex items-center justify-between px-5 py-5">
        <span className="text-xl font-black tracking-tight gradient-text">Cosign</span>
        <div className="flex items-center gap-4">
          {profile && (
            <Link to={`/${profile.username}`} className="text-sm font-semibold text-primary">
              My profile
            </Link>
          )}
          <button onClick={signOut} className="text-sm text-muted-foreground">
            Sign out
          </button>
        </div>
      </div>

      <div className="px-5">
        {phase === "week_one" ? (
          <Link to="/rank" className="flex items-center gap-3 rounded-2xl bg-card border border-border p-4">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Trophy className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground">Week one — see what's ranked so far</div>
              <div className="text-xs text-muted-foreground">Start building your own list</div>
            </div>
          </Link>
        ) : (
          <Link
            to={nearest ? `/shop/${nearest.id}` : "#"}
            className="flex items-center gap-3 rounded-2xl bg-card border border-border p-4"
          >
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground">
                {nearestLoading ? "Finding the closest shop…" : nearest ? nearest.name : "No shops seeded yet"}
              </div>
              <div className="text-xs text-muted-foreground">
                {phase === "finals" ? "Near me · open late · has outlets" : "Near me · open now · has outlets"}
              </div>
            </div>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3 mt-3">
          <Link to="/rank" className="rounded-2xl bg-card border border-border p-4 flex flex-col items-start gap-2">
            <Swords className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Rank two shops</span>
          </Link>
          <Link
            to={profile ? `/${profile.username}` : "/onboarding"}
            className="rounded-2xl bg-card border border-border p-4 flex flex-col items-start gap-2"
          >
            <Share2 className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">Share your list</span>
          </Link>
        </div>
      </div>

      {!profile && (
        <div className="px-5 mt-6">
          <EmptyState
            icon={<Compass className="w-6 h-6" />}
            title="Set up your profile"
            description="Pick a username and school to start ranking shops and get your own share link."
            action={<Link to="/onboarding" className="text-sm font-semibold text-primary">Get started</Link>}
          />
        </div>
      )}
    </div>
  );
};

export default Home;
