import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import type { Shop } from "@/types/cosign";

// Phase 3.1. The brief's ideal path is importing Google Maps saved places;
// that needs a Places API scope beyond autocomplete (reading a user's
// saved-places list) that isn't wired up yet, so this ships the brief's
// named fallback instead: pick 3 already-seeded shops into a starter list,
// so nobody lands on an empty profile on day one. Swap in the Maps import
// later without changing steps 1–2.
const OSU_SLUG = "osu";

const Onboarding = () => {
  const { user } = useAuth();
  const { createProfile } = useProfile();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [shops, setShops] = useState<Shop[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.from("shops").select("*").limit(30).then(({ data }) => setShops((data ?? []) as Shop[]));
  }, []);

  const finishStepOne = async () => {
    if (!username.trim() || !user) return;
    setSaving(true);
    const { data: school } = await supabase.from("schools").select("id").eq("slug", OSU_SLUG).single();
    const error = await createProfile(username.trim(), { school_id: school?.id ?? null });
    setSaving(false);
    if (!error) setStep(2);
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 3) next.add(id);
      return next;
    });
  };

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    const { data: list } = await supabase
      .from("lists")
      .insert({ title: "My Spots", owner_id: user.id })
      .select()
      .single();
    if (list) {
      await supabase.from("list_items").insert(
        Array.from(picked).map((shop_id, i) => ({
          list_id: list.id,
          shop_id,
          added_by: user.id,
          position: i,
        }))
      );
    }
    setSaving(false);
    navigate(`/${username.trim()}`);
  };

  return (
    <div className="min-h-screen flex flex-col px-6 py-10">
      {step === 1 ? (
        <div className="flex-1 flex flex-col gap-4 max-w-xs mx-auto w-full">
          <h1 className="text-2xl font-black text-foreground">Pick a username</h1>
          <p className="text-sm text-muted-foreground">
            You're on Ohio State — Cosign is scoped to one campus for now.
          </p>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
            placeholder="username"
            className="bg-card border border-border rounded-2xl px-4 py-3 text-foreground"
          />
          <button
            onClick={finishStepOne}
            disabled={!username.trim() || saving}
            className="mt-2 bg-primary text-primary-foreground rounded-2xl py-3 font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4 max-w-sm mx-auto w-full">
          <h1 className="text-2xl font-black text-foreground">Add your first 3 spots</h1>
          <p className="text-sm text-muted-foreground">
            Pick a few shops you already know — you can rank and add more later.
          </p>
          <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
            {shops.map((shop) => (
              <button
                key={shop.id}
                onClick={() => togglePick(shop.id)}
                className={`flex items-center justify-between rounded-2xl border p-3 text-left ${
                  picked.has(shop.id) ? "border-primary bg-primary/10" : "border-border bg-card"
                }`}
              >
                <span className="text-sm font-semibold text-foreground">{shop.name}</span>
                {picked.has(shop.id) && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
            {shops.length === 0 && (
              <p className="text-sm text-muted-foreground">No shops seeded for your campus yet — check back soon.</p>
            )}
          </div>
          <button
            onClick={finish}
            disabled={saving}
            className="mt-2 bg-primary text-primary-foreground rounded-2xl py-3 font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : picked.size > 0 ? `Add ${picked.size} and finish` : "Skip for now"}
          </button>
        </div>
      )}
    </div>
  );
};

export default Onboarding;
