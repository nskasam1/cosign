import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { api, type ShopSummary } from "@/lib/api";
import PlacePlate from "@/components/log/PlacePlate";

// Stub onboarding — the brief's "signup". A name and a school, then up to
// three places you already trust, which become your first list. No password,
// no email, no provider: auth v1 is a signed cookie over local users.
//
// Google Takeout import joins this flow in Phase 5A; the empty state below
// is where it will be offered.
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
    <main data-onboarding data-step={step} className="cs-wrap pb-16 pt-[max(var(--space-6),env(safe-area-inset-top))]">
      <p className="cs-caps border-b border-rule pb-4 text-gold">Cosign · starting out</p>

      {step === 1 ? (
        <>
          <h1 className="cs-display mt-6 text-balance text-3xl text-ink sm:text-4xl">Make your profile.</h1>
          <p className="mt-3 text-sm text-line">
            A name and a school. There is no password, because there is nothing here worth stealing and
            nowhere for it to go — everything stays on this machine.
          </p>

          <label htmlFor="ob-name" className="cs-caps mt-8 block text-gold">
            Your name
          </label>
          <input
            id="ob-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-2 w-full rounded-[var(--radius-md)] border border-rule-strong bg-surface p-3 text-base text-ink placeholder:text-muted"
            placeholder="Sam Whitfield"
          />

          <label htmlFor="ob-username" className="cs-caps mt-6 block text-gold">
            Username
          </label>
          <input
            id="ob-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-2 w-full rounded-[var(--radius-md)] border border-rule-strong bg-surface p-3 text-base text-ink placeholder:text-muted"
            placeholder="sam"
          />

          <p id="ob-school-label" className="cs-caps mt-6 text-gold">
            Your school
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="ob-school-label">
            {schools.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSchoolId(s.id)}
                aria-pressed={schoolId === s.id}
                className="cs-chip"
              >
                {s.name}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="mt-5 text-sm text-line">
              {error}
            </p>
          )}

          <div className="mt-8 border-t border-rule-strong pt-6">
            <button
              type="button"
              onClick={submitProfile}
              disabled={busy || !username.trim() || !displayName.trim() || !schoolId}
              className="cs-pill"
            >
              {busy ? "Making it…" : "That's me"}
            </button>
          </div>
        </>
      ) : (
        <>
          <h1 className="cs-display mt-6 text-balance text-3xl text-ink sm:text-4xl">
            Anywhere you already trust?
          </h1>
          <p className="mt-3 text-sm text-line">
            Up to three. They start a list — not a ranking: an order only comes from head-to-head, and that
            starts the first time you log a visit.
          </p>

          <div className="mt-6">
            {shops.map((s) => {
              // At the cap, the other rows genuinely cannot be picked — so
              // they say so, in the markup and on screen. Leaving them
              // looking and announcing exactly like the operable ones was
              // the app quietly ignoring a tap.
              const chosen = picked.has(s.id);
              const spent = picked.size >= 3 && !chosen;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-pick
                  data-shop-id={s.id}
                  onClick={() => togglePick(s.id)}
                  aria-pressed={chosen}
                  aria-disabled={spent || undefined}
                  className={`cs-row grid grid-cols-[3.5rem_1fr] items-center gap-x-4 py-4 ${spent ? "opacity-45" : ""}`}
                >
                  <PlacePlate name={s.name} photo={s.photo} palette={s.palette} size={56} />
                  <span className="min-w-0">
                    <span className={`cs-display block truncate text-lg ${chosen ? "text-ink" : "text-line"}`}>
                      {s.name}
                    </span>
                    <span className="cs-caps mt-1 block text-muted">
                      {spent ? "that's three — drop one first" : `${s.walk_min} min walk`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 border-t border-rule-strong pt-6">
            <button type="button" onClick={finish} disabled={busy} className="cs-pill">
              {busy ? "Saving…" : picked.size > 0 ? `Start with ${picked.size}` : "Skip for now"}
            </button>
          </div>
        </>
      )}
    </main>
  );
};

export default Onboarding;
