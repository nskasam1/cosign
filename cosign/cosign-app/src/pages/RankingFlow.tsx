import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import type { RankingEntry, Shop } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// Read-only for now. The old random-pair flow is gone on purpose: the only
// sanctioned ranking input is binary-search insertion, which runs at the
// end of the log flow (Phase 3, src/lib/insertion.ts). Until then this
// page shows the ranking the comparisons have already built.
const RankingFlow = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Array<RankingEntry & { shop: Shop }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myRanking()
      .then(({ entries }) => setEntries(entries))
      .finally(() => setLoading(false));
  }, []);

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

      {entries.length === 0 ? (
        <EmptyState
          icon={<Trophy className="w-6 h-6" />}
          title="No ranking yet"
          description="Your list builds itself one honest head-to-head at a time — that starts when you log your first visit."
          action={<Link to="/" className="text-sm text-primary font-semibold">Find a place to log</Link>}
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
    </div>
  );
};

export default RankingFlow;
