import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTitle } from "@/lib/title";
import Feed from "@/components/Feed";
import ImportTakeout from "@/components/ImportTakeout";
import Icon from "@/icons/Icon";

/**
 * Crew — the door six built features never had.
 *
 * Nothing on this page is new work. Friend requests, the activity feed, group
 * decision sessions, collaborative lists and the Google Maps import all
 * existed, were tested, and were unreachable: `/lists/:id` and `/group/new`
 * had no navigation entry at all, and the Maps import was mounted ONLY inside
 * the empty state of `/rank`, so it vanished permanently the moment somebody
 * ranked their first place and onboarding was a one-way door. The founder's
 * report was "the google maps feature just disappeared", and it had.
 *
 * So this re-homes rather than reinvents, and the components keep their own
 * `data-*` hooks so the existing suites still find them.
 */

type Section = "activity" | "friends" | "lists" | "groups";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "friends", label: "Friends" },
  { key: "lists", label: "Lists" },
  { key: "groups", label: "Groups" },
];

const Crew = () => {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("activity");
  useTitle(user ? "Your crew" : null);

  const friends = useQuery({ queryKey: ["friends"], queryFn: api.friends, enabled: !!user });
  const lists = useQuery({ queryKey: ["myLists"], queryFn: api.myLists, enabled: !!user });

  // Gate on the DATA, never on a loading flag: a query paused because the
  // browser went offline is neither loading nor errored.
  const friendsUnreachable = !friends.isLoading && !friends.data;
  const listsUnreachable = !lists.isLoading && !lists.data;

  return (
    <main data-crew data-section={section} className="cs-wrap pb-24 pt-[max(var(--space-6),env(safe-area-inset-top))]">
      <p className="cs-caps text-gold">Your crew</p>
      <h1 className="cs-display mt-2 text-3xl text-ink">The people you'd ask.</h1>

      <div role="group" aria-label="Crew sections" className="cs-chip-rail mt-5 flex gap-2 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            data-crew-tab={s.key}
            aria-pressed={section === s.key}
            onClick={() => setSection(s.key)}
            className="cs-chip"
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "activity" && (
        <div className="mt-6">
          <Feed />
        </div>
      )}

      {section === "friends" && (
        <section className="mt-6">
          {friendsUnreachable ? (
            <p data-friends-unreachable role="alert" className="text-sm text-line">
              Cosign can't reach its own server, so it can't tell you who your friends are. Nothing is
              wrong with them — try again in a moment.
            </p>
          ) : (
            <div className="cs-column space-y-3">
              {(friends.data?.incoming ?? []).length > 0 && (
                <p className="cs-caps text-gold">Waiting on you</p>
              )}
              {(friends.data?.incoming ?? []).map((r) => (
                <Link
                  key={r.friendship_id}
                  to={`/${r.user.username}`}
                  data-incoming={r.user.username}
                  className="cs-card flex items-center gap-3"
                >
                  <span className="cs-avatar" style={{ ["--avatar" as string]: "44px" }}>
                    {r.user.display_name[0]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg text-ink">{r.user.display_name}</span>
                    <span className="mt-0.5 block text-xs text-ember-ink">asked to be friends</span>
                  </span>
                  <Icon name="chevronRight" size={20} className="text-muted" />
                </Link>
              ))}
              {(friends.data?.accepted ?? []).map((f) => (
                <Link key={f.id} to={`/${f.username}`} data-friend={f.username} className="cs-card flex items-center gap-3">
                  {f.avatar ? (
                    <img src={f.avatar} alt="" className="cs-avatar" style={{ ["--avatar" as string]: "44px" }} />
                  ) : (
                    <span className="cs-avatar" style={{ ["--avatar" as string]: "44px" }}>
                      {f.display_name[0]}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg text-ink">{f.display_name}</span>
                    {f.taste_line && (
                      <span className="mt-0.5 block truncate text-xs text-muted">{f.taste_line}</span>
                    )}
                  </span>
                  <Icon name="chevronRight" size={20} className="text-muted" />
                </Link>
              ))}
              {friends.data && friends.data.accepted.length === 0 && friends.data.incoming.length === 0 && (
                <p className="text-sm text-line">
                  Nobody yet. A cosign is worth more from somebody you know — find them by name in Search.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {section === "lists" && (
        <section className="mt-6">
          {listsUnreachable ? (
            <p data-lists-unreachable role="alert" className="text-sm text-line">
              Cosign can't reach its own server, so it can't show your lists. Try again in a moment.
            </p>
          ) : (
            <div className="cs-column space-y-3">
              {(lists.data?.lists ?? []).map((l) => (
                <Link key={l.id} to={`/lists/${l.id}`} data-list-link={l.id} className="cs-card flex items-center gap-3">
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-[var(--radius-sm)] bg-raise text-gold">
                    <Icon name="list" size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg text-ink">{l.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {l.is_collaborative ? "Kept together" : "Yours"}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={20} className="text-muted" />
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {section === "groups" && (
        <section className="mt-6">
          <div className="cs-card">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[hsl(var(--ember)/0.14)] text-ember-ink">
              <Icon name="group" size={24} />
            </span>
            <h2 className="cs-display mt-3 text-xl text-ink">Where should the four of us go?</h2>
            <p className="mt-2 text-sm text-line">
              Everybody says what they need. Cosign finds the places that clear all of it. Nobody votes.
            </p>
            <Link to="/group/new" data-group-new className="cs-pill mt-4">
              Start a session
            </Link>
          </div>
        </section>
      )}

      {/* The Maps import, permanently reachable at last. It creates a LIST and
          never a ranking — an order comes from the head-to-head and from
          nowhere else. */}
      <section className="mt-8 border-t border-rule-strong pt-6">
        <ImportTakeout title="Saved in Maps" />
      </section>
    </main>
  );
};

export default Crew;
