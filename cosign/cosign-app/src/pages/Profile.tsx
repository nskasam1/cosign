import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { INTENT_TAG_LABELS } from "@/types/cosign";
import type { Profile as ProfileT, Shop, EloScore, IntentTag } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";
import { Users } from "lucide-react";

interface RankedShop extends Shop {
  elo_score: number;
}

// The authored object. This same component renders both the public
// `/:username` share link and the owner's own view (with edit controls) —
// per the brief, "the profile page ... same component that powers the
// public share link, just behind auth for the owner's edit controls."
// Note: this is the in-app client-rendered version. Production share
// traffic (link pasted into iMessage/Instagram) should hit the separate
// SSR edge function in api/s/[username].ts for the sub-1s, no-JS load —
// see that file and MIGRATION_NOTES.md's architecture section.
const Profile = () => {
  const { username } = useParams();
  const { profile: ownProfile, updateProfile } = useProfile();

  const [viewedProfile, setViewedProfile] = useState<ProfileT | null>(null);
  const [ranked, setRanked] = useState<RankedShop[]>([]);
  const [activeTag, setActiveTag] = useState<IntentTag | null>(null);
  const [loading, setLoading] = useState(true);

  const isOwnProfile = !!ownProfile && ownProfile.username === username;

  useEffect(() => {
    if (!username) return;
    (async () => {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .ilike("username", username)
        .maybeSingle();

      if (!profileData) { setLoading(false); return; }
      setViewedProfile(profileData as ProfileT);

      const { data: eloData } = await supabase.rpc("compute_user_elo", { p_user_id: profileData.id });
      const scores = (eloData ?? []) as EloScore[];
      if (scores.length === 0) { setLoading(false); return; }

      const { data: shops } = await supabase
        .from("shops")
        .select("*")
        .in("id", scores.map((s) => s.shop_id));

      const byId = new Map((shops as Shop[] ?? []).map((s) => [s.id, s]));
      const merged = scores
        .map((s) => {
          const shop = byId.get(s.shop_id);
          return shop ? { ...shop, elo_score: s.elo_score } : null;
        })
        .filter((s): s is RankedShop => s !== null)
        .sort((a, b) => b.elo_score - a.elo_score);

      setRanked(merged);
      setLoading(false);
    })();
  }, [username]);

  // Intent-tag filtering wires up once shop_intent_tag_tallies is joined
  // per-shop here; activeTag is tracked now so the chip UI exists in Phase 3
  // even though the filter itself lands with the join.
  const visibleRanked = ranked;

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!viewedProfile) {
    return (
      <EmptyState
        icon={<Users className="w-6 h-6" />}
        title="No one here yet"
        description={`@${username} hasn't set up a Cosign profile.`}
      />
    );
  }

  return (
    <div className="min-h-screen pb-10">
      <div className="flex items-center gap-4 px-5 pt-8 pb-4">
        <div className="w-16 h-16 rounded-full bg-muted flex-shrink-0 overflow-hidden">
          {viewedProfile.avatar_url && <img src={viewedProfile.avatar_url} alt={viewedProfile.username} className="w-full h-full object-cover" />}
        </div>
        <div>
          <h1 className="text-xl font-black text-foreground">{viewedProfile.display_name || viewedProfile.username}</h1>
          <p className="text-sm text-muted-foreground">@{viewedProfile.username}</p>
          {viewedProfile.one_line_taste_summary && (
            <p className="text-sm text-foreground mt-1">{viewedProfile.one_line_taste_summary}</p>
          )}
        </div>
      </div>

      {isOwnProfile && (
        <div className="px-5 pb-4">
          <button
            onClick={() => {
              const line = window.prompt("One-line taste summary", ownProfile?.one_line_taste_summary ?? "");
              if (line !== null) updateProfile({ one_line_taste_summary: line });
            }}
            className="text-sm font-semibold text-primary"
          >
            Edit taste summary
          </button>
        </div>
      )}

      <div className="flex gap-2 px-5 overflow-x-auto pb-3">
        {Object.entries(INTENT_TAG_LABELS).map(([tag, label]) => (
          <button
            key={tag}
            onClick={() => setActiveTag(activeTag === tag ? null : (tag as IntentTag))}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap ${
              activeTag === tag ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {visibleRanked.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="No ranked shops yet"
          description={isOwnProfile ? "Rank your first two shops to start building your list." : "This person hasn't ranked anything yet."}
          action={isOwnProfile && <Link to="/rank" className="text-sm font-semibold text-primary">Start ranking</Link>}
        />
      ) : (
        <ol className="px-5 flex flex-col gap-2">
          {visibleRanked.map((shop, i) => (
            <li key={shop.id}>
              <Link
                to={`/shop/${shop.id}`}
                className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3"
              >
                <span className="text-lg font-black text-muted-foreground w-6 text-center">{i + 1}</span>
                <div className="flex-1">
                  <div className="font-semibold text-foreground">{shop.name}</div>
                  <div className="text-xs text-muted-foreground">{shop.address}</div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}

      <div className="px-5 mt-8 flex justify-center">
        <Link to="/" className="text-sm font-semibold text-muted-foreground">
          Make your own on Cosign →
        </Link>
      </div>
    </div>
  );
};

export default Profile;
