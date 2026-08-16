import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { api, type ProfileView } from "@/lib/api";
import { paletteOf, paletteStyle } from "@/lib/palette";
import { track } from "@/lib/analytics";
import type { ShareToken } from "@/types/cosign";
import PlacePlate from "@/components/log/PlacePlate";
import Nothing from "@/components/Nothing";

// In-app profile: the owner's view of their ranking and their share links.
// The public artifact is the SSR page at /s/:token — minting and revoking
// those tokens happens here, because a share link is the per-list opt-in
// (decision 12) and it has to be as easy to take back as to make.
const Profile = () => {
  const { username } = useParams();
  const { user: viewer } = useAuth();

  const [data, setData] = useState<ProfileView | null>(null);
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!username) return;
    setLoading(true);
    api
      .profile(username)
      .then((d) => {
        setData(d);
        if (d.is_self) api.myShareTokens().then(({ tokens }) => setTokens(tokens));
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [username]);

  useEffect(load, [load]);

  const shareUrl = (token: string) => `${window.location.origin}/s/${token}`;

  const createShare = async () => {
    const { token } = await api.createShareToken({ kind: "ranking" });
    track("share_created", { kind: "ranking" });
    setTokens((prev) => [token, ...prev]);
  };

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(shareUrl(token));
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  const revoke = async (token: string) => {
    await api.revokeShareToken(token);
    setTokens((prev) => prev.map((t) => (t.token === token ? { ...t, revoked_at: new Date().toISOString() } : t)));
  };

  if (loading) {
    return (
      <main data-profile className="cs-wrap flex min-h-[60vh] items-center justify-center">
        <p className="cs-caps text-muted">Opening…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main data-profile data-state="missing" className="cs-wrap pt-6">
        <Nothing
          kicker="No one by that name"
          standalone
          title="Nobody here goes by that."
          body="Check the spelling, or they may not have made a profile yet. Cosign has no directory to browse — you get here from a link or a list."
          action={
            <Link to="/" className="cs-pill-ghost">
              Back home
            </Link>
          }
        />
      </main>
    );
  }

  const { user, entries, is_self, can_see_ranking } = data;
  const first = user.display_name.split(" ")[0];
  const rankingTokens = tokens.filter((t) => t.kind === "ranking");
  // Revoking is meant to be reversible: you can always mint a fresh link.
  const live = rankingTokens.filter((t) => !t.revoked_at);

  return (
    <main data-profile data-username={user.username} className="cs-wrap pt-[max(var(--space-5),env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
        <p className="cs-caps text-gold">Cosign · {is_self ? "you" : "a person"}</p>
        <p className="cs-caps text-right text-muted">@{user.username}</p>
      </div>

      <div className="mt-5 flex items-center gap-4">
        {user.avatar ? (
          <img src={user.avatar} alt="" width={56} height={56} className="h-14 w-14 flex-none rounded-full bg-surface" />
        ) : (
          <span className="grid h-14 w-14 flex-none place-items-center rounded-full bg-surface text-xl text-gold cs-display">
            {first[0]}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="cs-display text-2xl text-ink sm:text-3xl">{user.display_name}</h1>
          <p className="cs-caps mt-1 text-muted">
            {data.logs_count} {data.logs_count === 1 ? "visit" : "visits"} written down
            {entries.length > 0 && ` · ${entries.length} in order`}
          </p>
        </div>
      </div>

      {user.taste_line && <p className="mt-4 text-base text-line">“{user.taste_line}”</p>}
      {user.signature_order && (
        <p className="cs-caps mt-2 text-gold">Usually orders a {user.signature_order}</p>
      )}

      {is_self && (
        <section data-share className="mt-8 border-y border-rule-strong py-5">
          <h2 className="cs-caps text-gold">Your share link</h2>
          <p className="mt-2 text-sm text-line">
            Your list is friends-only until you make one of these. A link is the whole opt-in — one page, no
            login, nobody else's list on it — and turning it off closes the page for good.
          </p>
          {live.length === 0 && (
            <button type="button" data-make-share onClick={createShare} className="cs-pill mt-4">
              Make a link
            </button>
          )}
          <ul className="mt-3">
            {rankingTokens.map((t) => (
              <li key={t.token} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule py-3">
                <span className={`min-w-0 flex-1 truncate text-sm ${t.revoked_at ? "text-muted line-through" : "text-line"}`}>
                  /s/{t.token}
                </span>
                {t.revoked_at ? (
                  <span className="cs-caps flex-none text-muted">off</span>
                ) : (
                  <>
                    <button type="button" onClick={() => copy(t.token)} className="cs-word cs-caps flex-none text-ember-ink">
                      {copied === t.token ? "copied" : "copy"}
                    </button>
                    <button type="button" onClick={() => revoke(t.token)} className="cs-word cs-caps flex-none text-muted">
                      turn off
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {can_see_ranking ? (
        entries.length > 0 ? (
          <ol className="mt-8">
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
        ) : (
          <div className="mt-8">
            <Nothing
              kicker="Nothing in order yet"
              title={is_self ? "A list of one is still a list." : `${first} hasn't put anywhere in order yet.`}
              body={
                is_self
                  ? "Log a visit and the head-to-head starts on its own. Your first place needs no comparison at all — everything after it gets held up against what's already there."
                  : "Nothing to see here yet, which is its own kind of honest."
              }
              action={
                is_self ? (
                  <Link to="/log" className="cs-pill">
                    Log a visit
                  </Link>
                ) : undefined
              }
            />
          </div>
        )
      ) : (
        <div className="mt-8">
          <Nothing
            kicker="Friends only"
            title={`${first}'s list isn't public.`}
            body={`Everything on Cosign is friends-only until somebody sends a link — that includes ${first}'s. Ask them for theirs; that's what it's for.`}
          />
        </div>
      )}

      {!viewer && (
        <div className="mt-10 border-t border-rule-strong pt-6">
          <p className="text-sm text-muted">A name and a school is the whole signup.</p>
          <Link to="/onboarding" className="cs-pill-ghost mt-4">
            Make your own list
          </Link>
        </div>
      )}
    </main>
  );
};

export default Profile;
