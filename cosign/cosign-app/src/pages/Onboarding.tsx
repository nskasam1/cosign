import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Coffee } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api, type ShopSummary } from "@/lib/api";

// Stub onboarding (the brief's "signup"): make a name+school profile, then
// pick up to 3 starter spots into a first list. Google Maps saved-places
// import (Takeout fixtures) joins this flow in Phase 5A.
const Onboarding = () => {
  const { user, createAccount, refresh } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(user ? 2 : 1);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [schools, setSchools] = useState<Array<{ id: string; name: string }>>([]);
  const [schoolId, setSchoolId] = useState<string>("");

  useEffect(() => {
    api.shops().then(({ shops }) => setShops(shops));
    api.meta().then(({ schools }) => {
      setSchools(schools);
      setSchoolId((prev) => prev || schools[0]?.id || "");
    });
  }, []);

  // `user` is null on first render while /api/me is in flight, so the step
  // can't be decided from it up front — skip the profile step once it lands.
  useEffect(() => {
    if (user) setStep(2);
  }, [user]);

  const submitProfile = async () => {
    setBusy(true);
    setError(null);
    try {
      await createAccount({
        username: username.trim(),
        display_name: displayName.trim(),
        school_id: schoolId,
      });
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    try {
      if (picked.size > 0) {
        const { list } = await api.createList({ title: "My spots" });
        for (const shopId of picked) await api.addListItem(list.id, shopId);
      }
      await refresh();
      navigate("/");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen px-5 py-10 max-w-md mx-auto">
      {step === 1 ? (
        <div>
          <Coffee className="w-8 h-8 text-primary mb-3" />
          <h1 className="text-2xl font-black text-foreground mb-1">Make your profile</h1>
          <p className="text-sm text-muted-foreground mb-6">
            A name and a school. That's the whole signup.
          </p>
          <label className="block text-sm text-muted-foreground mb-1" htmlFor="ob-name">Your name</label>
          <input
            id="ob-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl bg-card border border-border p-3 mb-4 text-foreground"
            placeholder="Sam Whitfield"
          />
          <label className="block text-sm text-muted-foreground mb-1" htmlFor="ob-username">Username</label>
          <input
            id="ob-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl bg-card border border-border p-3 mb-2 text-foreground"
            placeholder="sam"
          />
          <p className="block text-sm text-muted-foreground mb-1" id="ob-school-label">Your school</p>
          <div className="flex flex-wrap gap-2 mb-4" role="group" aria-labelledby="ob-school-label">
            {schools.map((s) => (
              <button
                key={s.id}
                onClick={() => setSchoolId(s.id)}
                aria-pressed={schoolId === s.id}
                className={`rounded-full border px-4 py-2 text-sm min-h-[44px] ${
                  schoolId === s.id ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-destructive mb-3">{error}</p>}
          <button
            onClick={submitProfile}
            disabled={busy || !username.trim() || !displayName.trim() || !schoolId}
            className="w-full rounded-xl bg-primary text-primary-foreground font-semibold p-3 disabled:opacity-50 min-h-[44px]"
          >
            {busy ? "Making it…" : "That's me"}
          </button>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-black text-foreground mb-1">Pick your spots</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Up to three places you already trust. They start your first list.
          </p>
          <div className="grid gap-2 mb-6">
            {shops.map((s) => (
              <button
                key={s.id}
                onClick={() => togglePick(s.id)}
                aria-pressed={picked.has(s.id)}
                className={`rounded-2xl border p-3 flex items-center gap-3 text-left min-h-[44px] ${
                  picked.has(s.id) ? "border-primary bg-primary/10" : "border-border bg-card"
                }`}
              >
                {s.photo ? (
                  <img src={s.photo} alt="" className="w-10 h-10 rounded-xl object-cover" loading="lazy" />
                ) : (
                  <span className="w-10 h-10 rounded-xl bg-muted grid place-items-center text-primary">☕</span>
                )}
                <span className="text-sm font-semibold text-foreground">{s.name}</span>
              </button>
            ))}
          </div>
          <button
            onClick={finish}
            disabled={busy}
            className="w-full rounded-xl bg-primary text-primary-foreground font-semibold p-3 disabled:opacity-50 min-h-[44px]"
          >
            {busy ? "Saving…" : picked.size > 0 ? `Start with ${picked.size}` : "Skip for now"}
          </button>
        </div>
      )}
    </div>
  );
};

export default Onboarding;
