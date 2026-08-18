import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, api, type ShopSummary } from "@/lib/api";
import { useTitle } from "@/lib/title";
import ImportTakeout from "@/components/ImportTakeout";
import PlacePlate from "@/components/log/PlacePlate";

// Stub onboarding — the brief's "signup". A name and a school, then up to
// three places you already trust, which become your first list. No password,
// no email, no provider: auth v1 is a signed cookie over local users.
//
// Step two has two doors, which is the point of brief #9: tap three places
// you already trust, or hand over the ones you have been saving in Google
// Maps for two years. The second door is the honest one for most people —
// but it is below the first, not instead of it, because somebody with no
// export at all must not arrive at a screen that only knows how to import.
// The server's refusals are machine strings — `bad username`, `unknown
// school` — and this screen printed whichever one came back, verbatim, at
// somebody two fields into their first minute with the product. Worse, a
// rejected fetch is not an ApiError at all and has no `error` field, so a
// server that was simply not running rendered the browser's own "Failed to
// fetch". One sentence each, in the app's voice, and an honest fallback that
// distinguishes "we said no" from "we never heard".
const SIGNUP_TROUBLE: Record<string, string> = {
  "bad username": "Usernames are 2–24 characters — letters, numbers, and . - _ if you like.",
  "display name required": "Cosign needs a name to put at the top of your list.",
  "username taken": "Somebody already has that one. Try another.",
  "unknown school": "Pick one of the schools above — those are the ones Cosign knows so far.",
};

function signupTrouble(e: unknown): string {
  if (e instanceof ApiError) return SIGNUP_TROUBLE[e.message] ?? "That didn't go through. Tap it again.";
  return "Cosign can't reach its own server, so nothing was made. Check your connection and tap it again.";
}

const Onboarding = () => {
  useTitle("Start your list");
  const { user, createAccount, refresh } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(user ? 2 : 1);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Places an import already landed — the exit stops saying "skip". */
  const [imported, setImported] = useState(0);
  const [schools, setSchools] = useState<Array<{ id: string; name: string }>>([]);
  const [schoolId, setSchoolId] = useState<string>("");

  /** Neither list arrived. Not `isError` — a paused request is neither. */
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    // Both of these were bare `.then`s. With the server unreachable, `schools`
    // stayed empty, so the school row rendered nothing, "That's me" was
    // disabled forever by `!schoolId`, and the screen gave no reason at all —
    // the first minute of the product, silently broken.
    api
      .shops()
      .then(({ shops }) => setShops(shops))
      .catch(() => setUnreachable(true));
    api
      .meta()
      .then(({ schools }) => {
        setSchools(schools);
        setSchoolId((prev) => prev || schools[0]?.id || "");
      })
      .catch(() => setUnreachable(true));
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
      setError(signupTrouble(e));
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
    setError(null);
    try {
      if (picked.size > 0) {
        const { list } = await api.createList({ title: "My spots" });
        for (const shopId of picked) await api.addListItem(list.id, shopId);
      }
      await refresh();
      navigate("/");
    } catch {
      // A try/finally with no catch flipped the button back to "Start with 3"
      // and said nothing, which reads as "I did that" to somebody who is now
      // stranded on step two with three places still selected.
      setError("That didn't save. Your picks are still here — tap it again.");
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
          {/* Gate on the DATA, never on a loading flag: a request the browser
              paused because it went offline is neither loading nor errored.
              With no schools there is nothing to press and "That's me" can
              never enable, so the screen has to say why rather than sit
              there looking finished. */}
          {schools.length === 0 && unreachable && (
            <p data-schools-unreachable role="alert" className="mt-3 text-sm text-line">
              Cosign can't reach its own server, so it can't offer you a school yet. Nothing is broken on your
              end — try again in a moment.
            </p>
          )}

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

          <div className="mt-8">
            <ImportTakeout title="Saved in Maps" onImported={(_list, places) => setImported(places)} />
          </div>

          <p className="cs-caps mt-10 border-t border-rule pt-4 text-gold">Or pick them here</p>

          {/* "Or pick them here" over nothing at all was the other half of the
              same silence: the heading promises a campus and the server never
              sent one. The import door above still works, so say which one is
              shut rather than making the whole step look empty. */}
          {shops.length === 0 && unreachable && (
            <p data-shops-unreachable role="alert" className="mt-3 text-sm text-line">
              Cosign can't reach its own server, so it can't list the campus right now. The import above still
              works, and you can skip this and add places later.
            </p>
          )}

          {/* The campus arriving is the one moment on this screen worth
              marking — and the only one, since a tap here just presses. */}
          <div className="cs-column mt-4">
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

          {error && (
            <p role="alert" className="mt-5 text-sm text-line">
              {error}
            </p>
          )}

          <div className="mt-8 border-t border-rule-strong pt-6">
            <button type="button" onClick={finish} disabled={busy} className="cs-pill">
              {busy
                ? "Saving…"
                : picked.size > 0
                  ? `Start with ${picked.size}`
                  : imported > 0
                    ? "That's everything"
                    : "Skip for now"}
            </button>
          </div>
        </>
      )}
    </main>
  );
};

export default Onboarding;
