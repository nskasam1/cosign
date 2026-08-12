import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/analytics";
import type { Shop } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// Phase 3.2 — head-to-head ranking flow. Two shops, tap the one you'd
// recommend. Must resolve in well under 10s per comparison on a real
// phone — no rating scale, no text input, just a pick.
const RankingFlow = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pair, setPair] = useState<[Shop, Shop] | null>(null);
  const [pool, setPool] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const pickPair = useCallback((shops: Shop[]) => {
    if (shops.length < 2) { setPair(null); return; }
    const a = shops[Math.floor(Math.random() * shops.length)];
    let b = shops[Math.floor(Math.random() * shops.length)];
    while (b.id === a.id) b = shops[Math.floor(Math.random() * shops.length)];
    setPair([a, b]);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("shops").select("*");
      const shops = (data ?? []) as Shop[];
      setPool(shops);
      pickPair(shops);
      setLoading(false);
    })();
  }, [pickPair]);

  const choose = async (winner: Shop, loser: Shop) => {
    if (!user || submitting) return;
    setSubmitting(true);
    await supabase.from("rankings").insert({
      user_id: user.id,
      shop_a_id: winner.id,
      shop_b_id: loser.id,
      winner_id: winner.id,
    });
    track("ranking_recorded", { winner_id: winner.id, loser_id: loser.id });
    setSubmitting(false);
    pickPair(pool);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!pair) {
    return (
      <EmptyState
        icon={<X className="w-6 h-6" />}
        title="Not enough shops yet"
        description="Once at least two shops are seeded for your campus, you can start ranking them head-to-head."
        action={
          <button onClick={() => navigate("/")} className="text-sm text-primary font-semibold">
            Back home
          </button>
        }
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-sm font-semibold text-muted-foreground">Which would you recommend?</span>
        <button onClick={() => navigate("/")} aria-label="Close">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-4 px-5 pb-8">
        <AnimatePresence mode="wait">
          {pair.map((shop) => (
            <motion.button
              key={shop.id}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              disabled={submitting}
              onClick={() => choose(shop, pair.find((s) => s.id !== shop.id)!)}
              className="flex-1 rounded-3xl bg-card border border-border gradient-card card-shine flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <span className="text-2xl font-black text-foreground">{shop.name}</span>
              <span className="text-sm text-muted-foreground">{shop.address}</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default RankingFlow;
