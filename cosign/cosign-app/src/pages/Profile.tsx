import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Share2, User as UserIcon, Link2, Copy, Ban } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api, type ProfileView } from "@/lib/api";
import { track } from "@/lib/analytics";
import type { ShareToken } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// In-app profile: the owner's view of their ranking + share-link controls.
// The public artifact is the SSR page at /s/:token — creating and revoking
// those tokens happens here (decision 12: the share link is the opt-in).
const Profile = () => {
  const { username } = useParams();
  const { user: viewer } = useAuth();

  const [data, setData] = useState<ProfileView | null>(null);
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!username) return;
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
      <div className="flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={<UserIcon className="w-6 h-6" />}
        title="No one by that name"
        description="Check the username, or maybe they haven't made a profile yet."
        action={<Link to="/" className="text-sm text-primary font-semibold">Back home</Link>}
      />
    );
  }

  const { user, entries, is_self, can_see_ranking } = data;
  const rankingTokens = tokens.filter((t) => t.kind === "ranking");
  // Revoking is meant to be reversible: you can always mint a fresh link.
  const activeRankingTokens = rankingTokens.filter((t) => !t.revoked_at);

  return (
    <div className="min-h-screen px-5 py-8 max-w-md mx-auto">
      <header className="flex items-center gap-3 mb-6">
        {user.avatar ? (
          <img src={user.avatar} alt="" className="w-14 h-14 rounded-full" />
        ) : (
          <span className="w-14 h-14 rounded-full bg-muted grid place-items-center text-xl">{user.display_name[0]}</span>
        )}
        <div>
          <h1 className="text-xl font-black text-foreground">{user.display_name}</h1>
          <p className="text-xs text-muted-foreground">@{user.username} · {data.logs_count} logs</p>
          {user.taste_line && <p className="text-sm text-muted-foreground italic mt-0.5">{user.taste_line}</p>}
        </div>
      </header>

      {is_self && (
        <section className="mb-8 rounded-2xl bg-card border border-border p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
            <Share2 className="w-4 h-4 text-primary" /> Share your ranking
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            A share link is the only way anyone outside your friends sees this list. Turn it off any time.
          </p>
          {activeRankingTokens.length === 0 && (
            <button
              onClick={createShare}
              className="rounded-xl bg-primary text-primary-foreground text-sm font-semibold px-4 py-2.5 min-h-[44px]"
            >
              Make a share link
            </button>
          )}
          <ul className="space-y-2">
            {rankingTokens.map((t) => (
              <li key={t.token} className="flex items-center gap-2 text-sm">
                <Link2 className="w-4 h-4 text-muted-foreground flex-none" />
                <span className={`truncate ${t.revoked_at ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  /s/{t.token}
                </span>
                {!t.revoked_at && (
                  <>
                    <button onClick={() => copy(t.token)} aria-label="Copy link" className="p-2 text-primary">
                      <Copy className="w-4 h-4" />
                    </button>
                    {copied === t.token && <span className="text-xs text-primary">copied</span>}
                    <button onClick={() => revoke(t.token)} aria-label="Revoke link" className="p-2 text-muted-foreground">
                      <Ban className="w-4 h-4" />
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
        ) : (
          <EmptyState
            icon={<Share2 className="w-6 h-6" />}
            title={is_self ? "Nothing ranked yet" : "Nothing ranked yet"}
            description={
              is_self
                ? "Log a visit and rank your first place — your list starts with one honest call."
                : `${user.display_name.split(" ")[0]} hasn't ranked anywhere yet.`
            }
            action={is_self ? <Link to="/rank" className="text-sm text-primary font-semibold">Start ranking</Link> : undefined}
          />
        )
      ) : (
        <EmptyState
          icon={<UserIcon className="w-6 h-6" />}
          title="Friends only"
          description={`${user.display_name.split(" ")[0]}'s ranking is visible to friends. Ask them for their share link — that's the point of it.`}
        />
      )}

      {!viewer && (
        <footer className="mt-10 text-center">
          <Link to="/onboarding" className="text-sm text-primary underline-offset-4 hover:underline">
            Make your own list on Cosign
          </Link>
        </footer>
      )}
    </div>
  );
};

export default Profile;
