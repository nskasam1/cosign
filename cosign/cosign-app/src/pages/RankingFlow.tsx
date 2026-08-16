import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { paletteOf, paletteStyle } from "@/lib/palette";
import { useTitle } from "@/lib/title";
import type { Log, RankingEntry, Shop } from "@/types/cosign";
import PlacePlate from "@/components/log/PlacePlate";
import Nothing from "@/components/Nothing";

// Read-only: the only sanctioned ranking input is binary-search insertion,
// which runs at the end of the log flow (src/pages/PlaceFlow.tsx). This page
// shows the list those comparisons built — set the way the share page sets
// it, because it is the same object, and a person should recognise their own
// list when they send it.
const RankingFlow = () => {
  useTitle("Your list");
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
      <main data-ranking className="cs-wrap flex min-h-[60vh] items-center justify-center">
        <p className="cs-caps text-muted">Reading your list…</p>
      </main>
    );
  }

  return (
    <main data-ranking className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
        <button type="button" data-back onClick={() => navigate(-1)} className="cs-word cs-caps text-muted">
          Back
        </button>
        <p className="cs-caps text-right text-gold">Cosign · your list</p>
      </div>

      <h1 className="cs-display mt-5 text-3xl text-ink sm:text-4xl">In order.</h1>
      {entries.length > 0 && (
        <p className="cs-caps mt-3 text-muted">
          {entries.length} {entries.length === 1 ? "place" : "places"} · put here head to head, never scored
        </p>
      )}

      {failed ? (
        <div className="mt-8">
          <Nothing
            kicker="Couldn't read it"
            title="That's this screen, not your list."
            body="Nothing was lost — every comparison you've ever tapped is still on disk. Try again in a moment."
            action={
              <button type="button" onClick={() => window.location.reload()} className="cs-pill-ghost">
                Reload
              </button>
            }
          />
        </div>
      ) : entries.length === 0 ? (
        <div className="mt-8">
          <Nothing
            kicker="Nothing in order yet"
            title="A list starts with one honest call."
            body="Log a visit and Cosign will hold it up against the next one — this place or that one, one question at a time. Nobody scores anything."
            action={
              <Link to="/log" className="cs-pill">
                Log a visit
              </Link>
            }
          />
        </div>
      ) : (
        <ol className="mt-6">
          {entries.map((e) => (
            <li key={e.shop_id}>
              <Link
                to={`/shop/${e.shop.slug}`}
                data-entry
                data-position={e.position}
                style={paletteStyle(paletteOf(e.shop.palette))}
                className="cs-row grid grid-cols-[2.1rem_3.5rem_1fr] items-center gap-x-3 py-4"
              >
                <span className="cs-display cs-figures text-right text-2xl text-[hsl(var(--pal))]">
                  {e.position}
                </span>
                <PlacePlate name={e.shop.name} photo={null} palette={e.shop.palette} size={56} />
                <span className="min-w-0">
                  <span className="cs-display block truncate text-lg text-ink">{e.shop.name}</span>
                  {e.shop.one_liner && (
                    <span className="mt-1 block truncate text-xs text-muted">{e.shop.one_liner}</span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {unranked.length > 0 && (
        <section className="mt-10 border-t border-rule-strong pt-6" data-unranked>
          <h2 className="cs-caps text-gold">Logged, not ranked yet</h2>
          <p className="mt-2 text-xs text-muted">
            You wrote these visits down but left before the head-to-head. It's two or three taps each.
          </p>
          <div className="mt-3">
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
    </main>
  );
};

export default RankingFlow;
