import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import type { Log, RankingEntry, Shop } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// Read-only: the only sanctioned ranking input is binary-search insertion,
// which runs at the end of the log flow (src/pages/PlaceFlow.tsx). This page
// shows the list those comparisons have built — and, since Phase 3, offers a
// way back into the head-to-head for a visit that was logged but never put
// in order.
const RankingFlow = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Array<RankingEntry & { shop: Shop }>>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Without the catch a single rejected request skips the .then, leaves an
    // unhandled rejection, and renders the "no ranking yet" empty state to
    // someone whose list is fine — the worst possible lie on this page.
    Promise.all([api.myRanking(), api.myLogs(), api.shops()])
      .then(([r, l, s]) => {
        setEntries(r.entries);
        setLogs(l.logs);
        setShops(s.shops);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Abandoning the head-to-head discards the taps, never the visit — so a
  // logged place with no position is a resumable state, not a lost one.
  const unranked = useMemo(() => {
    const ranked = new Set(entries.map((e) => e.shop_id));
    const seen = new Set<string>();
    const out: Shop[] = [];
    for (const log of logs) {
      if (ranked.has(log.shop_id) || seen.has(log.shop_id)) continue;
      seen.add(log.shop_id);
      const shop = shops.find((s) => s.id === log.shop_id);
      if (shop) out.push(shop);
    }
    return out;
  }, [entries, logs, shops]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-6 max-w-md mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <h1 className="text-xl font-black text-foreground">My ranking</h1>
      </div>

      {failed ? (
        <EmptyState
          icon={<Trophy className="w-6 h-6" />}
          title="Couldn't read your list"
          description="That's this screen, not your ranking — nothing was lost. Try again in a moment."
          action={
            <button onClick={() => window.location.reload()} className="text-sm text-primary font-semibold">
              Reload
            </button>
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Trophy className="w-6 h-6" />}
          title="No ranking yet"
          description="Your list builds itself one honest head-to-head at a time — that starts when you log your first visit."
          action={<Link to="/log" className="text-sm text-primary font-semibold">Log a visit</Link>}
        />
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <li key={e.shop_id}>
              <Link
                to={`/shop/${e.shop.slug}`}
                className="flex items-center gap-3 rounded-2xl bg-card border border-border p-3 hover:border-primary/60"
              >
                <span className="text-primary font-black w-6 text-right">{e.position}</span>
                <span className="text-sm font-semibold text-foreground">{e.shop.name}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {unranked.length > 0 && (
        <section className="mt-8" data-unranked>
          <h2 className="cs-caps text-gold">Logged, not ranked yet</h2>
          <div className="mt-2">
            {unranked.map((s) => (
              <Link
                key={s.id}
                to={`/log/rank/${s.id}`}
                data-rank-it
                data-shop-id={s.id}
                className="cs-row flex items-center justify-between gap-3 py-4"
              >
                <span className="cs-display truncate text-lg text-line">{s.name}</span>
                <span className="cs-caps flex-none text-ember-ink">Rank it</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default RankingFlow;
