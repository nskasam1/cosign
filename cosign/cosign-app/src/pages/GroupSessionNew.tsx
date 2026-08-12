import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Shop } from "@/types/cosign";

// Phase 4.1 — starting a group decision session. Candidate picking is
// intentionally plain (tap 3–5 from the directory); the payoff is the
// voting page (GroupSession.tsx) participants land on via the share link.
const GroupSessionNew = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [shops, setShops] = useState<Shop[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from("shops").select("*").then(({ data }) => setShops((data ?? []) as Shop[]));
  }, []);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      return next;
    });
  };

  const create = async () => {
    if (!user || picked.size < 2) return;
    setCreating(true);
    const { data } = await supabase
      .from("group_sessions")
      .insert({ created_by: user.id, shop_candidates: Array.from(picked), quorum: 2 })
      .select()
      .single();
    setCreating(false);
    if (data) navigate(`/group/${data.id}`);
  };

  return (
    <div className="min-h-screen px-6 py-10 flex flex-col gap-4 max-w-sm mx-auto">
      <h1 className="text-2xl font-black text-foreground">Start a group decision</h1>
      <p className="text-sm text-muted-foreground">Pick 3–5 candidates, then share the link.</p>
      <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto">
        {shops.map((shop) => (
          <button
            key={shop.id}
            onClick={() => toggle(shop.id)}
            className={`flex items-center justify-between rounded-2xl border p-3 text-left ${
              picked.has(shop.id) ? "border-primary bg-primary/10" : "border-border bg-card"
            }`}
          >
            <span className="text-sm font-semibold text-foreground">{shop.name}</span>
            {picked.has(shop.id) && <Check className="w-4 h-4 text-primary" />}
          </button>
        ))}
      </div>
      <button
        onClick={create}
        disabled={picked.size < 2 || creating}
        className="mt-2 bg-primary text-primary-foreground rounded-2xl py-3 font-semibold disabled:opacity-50"
      >
        {creating ? "Creating…" : `Create with ${picked.size} candidates`}
      </button>
    </div>
  );
};

export default GroupSessionNew;
