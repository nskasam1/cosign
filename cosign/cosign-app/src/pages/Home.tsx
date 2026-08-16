import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Compass, MapPin, Trophy, Share2, ListOrdered } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api, type Meta, type ShopSummary } from "@/lib/api";
import { track } from "@/lib/analytics";
import EmptyState from "@/components/EmptyState";

// Phase 1 holding shape — the real home (hero query chip, friend-weighted
// discovery, freshness, app shell) is Phase 4. This proves the local data
// path: shops from SQLite, distance from the stubbed campus coordinate,
// open-now from shop_hours.
const Home = () => {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    track("app_open");
    Promise.all([api.meta(), api.shops()])
      .then(([m, s]) => {
        setMeta(m);
        setShops(s.shops);
      })
      .finally(() => setLoading(false));
  }, []);

  // "near me, open now, has outlets" — the hero query, stub-grade for now
  const heroPick = shops
    .filter((s) => s.open_now && (s.amenities?.outlet_count ?? 0) > 0)
    .sort((a, b) => a.distance_m - b.distance_m)[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 pb-16 pt-8 max-w-md mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-foreground">Cosign</h1>
          <p className="text-xs text-muted-foreground">
            {meta?.phase === "finals"
              ? "Finals week. Godspeed."
              : meta?.phase === "week_one"
                ? "Week one — go find your spot."
                : meta?.phase === "break"
                  ? "Campus is quiet. Good."
                  : "Know where to go."}
          </p>
        </div>
        {user && (
          <button onClick={() => signOut()} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            {user.display_name} · switch
          </button>
        )}
      </header>

      {/* The whole log fits in six taps, and none of them may wait on the
          network: warming these three on pointerdown means every step after
          the entry tap renders from memory and the flow makes exactly one
          request — the one that saves. */}
      <Link
        to="/log"
        data-log-entry
        onPointerDown={() => {
          const warm = { staleTime: 5 * 60_000 };
          void qc.prefetchQuery({ queryKey: ["shops"], queryFn: api.shops, ...warm });
          void qc.prefetchQuery({ queryKey: ["meta"], queryFn: api.meta, ...warm });
          void qc.prefetchQuery({ queryKey: ["ranking", "me"], queryFn: api.myRanking, ...warm });
        }}
        className="cs-pill mb-6"
      >
        Log a visit
      </Link>

      {heroPick ? (
        <Link
          to={`/shop/${heroPick.slug}`}
          className="block rounded-2xl bg-card border border-border p-4 mb-6 hover:border-primary/60"
        >
          <p className="text-xs text-primary font-semibold mb-1 flex items-center gap-1">
            <Compass className="w-3.5 h-3.5" /> Near you, open now, has outlets
          </p>
          <p className="text-lg font-bold text-foreground">{heroPick.name}</p>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> {heroPick.walk_min} min walk
            {heroPick.amenities?.outlet_count ? ` · ${heroPick.amenities.outlet_count} outlets` : ""}
          </p>
        </Link>
      ) : (
        <div className="mb-6">
          <EmptyState
            icon={<Compass className="w-6 h-6" />}
            title="Nothing open with outlets right now"
            description="Late night? The Night Owl crowd would know. Check the full list."
          />
        </div>
      )}

      <nav className="grid gap-3">
        <Link to="/rank" className="rounded-2xl bg-card border border-border p-4 flex items-center gap-3 hover:border-primary/60">
          <Trophy className="w-5 h-5 text-primary" />
          <span className="text-sm font-semibold text-foreground">My ranking</span>
        </Link>
        {user && (
          <Link
            to={`/${user.username}`}
            className="rounded-2xl bg-card border border-border p-4 flex items-center gap-3 hover:border-primary/60"
          >
            <Share2 className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">My profile & share link</span>
          </Link>
        )}
      </nav>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1">
          <ListOrdered className="w-4 h-4" /> Every shop near campus
        </h2>
        <div className="grid gap-2">
          {shops
            .slice()
            .sort((a, b) => a.distance_m - b.distance_m)
            .map((s) => (
              <Link
                key={s.id}
                to={`/shop/${s.slug}`}
                className="rounded-2xl bg-card border border-border p-3 flex items-center gap-3 hover:border-primary/60"
              >
                {s.photo ? (
                  <img src={s.photo} alt="" className="w-12 h-12 rounded-xl object-cover" loading="lazy" />
                ) : (
                  <span className="w-12 h-12 rounded-xl bg-muted grid place-items-center text-primary">☕</span>
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground truncate">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {s.walk_min} min · {s.open_now ? "open" : "closed"}
                    {s.stale ? " · info getting old" : ""}
                  </span>
                </span>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
};

export default Home;
