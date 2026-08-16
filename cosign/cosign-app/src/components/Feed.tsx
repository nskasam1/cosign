import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type FeedEntry } from "@/lib/api";
import Nothing from "@/components/Nothing";

/**
 * The notification feed (brief #11), at the top of your own page.
 *
 * There is no fifth tab and no inbox. These are things that happened to
 * *you*, so they live on the page that is about you — and the column is split
 * by whether a line ASKS you something or merely TELLS you something, because
 * the two are different in kind and only the first is ever counted anywhere.
 *
 * Nothing here can appear without a person having done one of exactly five
 * things, and the page says which five, on the page it is describing.
 */

/** The five, said as the sentences they are. */
const FIVE = [
  "Someone asks to be your friend",
  "Someone says yes to you",
  "Someone makes you an editor of a list",
  "Someone puts a shared list you edit back in order",
  "A friend asks what you need tonight",
];

const first = (name: string) => name.split(" ")[0];

function title(e: FeedEntry): string {
  const who = e.actor.display_name;
  switch (e.type) {
    case "friend_request":
      return `${who} asked to be friends.`;
    case "friend_accepted":
      return `${first(who)} said yes.`;
    case "list_editor_added":
      return `${first(who)} made you an editor of ${e.subject.title as string}.`;
    case "list_reranked":
      return `${first(who)} put ${e.subject.title as string} back in order.`;
    case "group_invite":
      return `${first(who)} asked what you need tonight.`;
  }
}

function body(e: FeedEntry): string | null {
  switch (e.type) {
    case "friend_request":
      return e.subject.status === "accepted"
        ? "Already answered — you two are friends."
        : "Adding somebody lets their ranked list count on your Home, and yours on theirs.";
    case "friend_accepted":
      return "You asked, and that was the answer.";
    case "list_editor_added":
      return "You can add to it, take off it, and put it back in order.";
    case "list_reranked": {
      const moved = e.subject.moved as number;
      return `${moved} ${moved === 1 ? "place" : "places"} moved. Nothing on that list has ever moved on its own.`;
    }
    case "group_invite": {
      const answered = e.subject.answered as number;
      if (e.subject.status !== "open") return "That table has finished.";
      return answered === 0
        ? "Nobody has said what they need yet. It works the answer out when they have."
        : `${answered} ${answered === 1 ? "person has" : "people have"} already said theirs — it works the answer out when you have too.`;
    }
  }
}

/** "FROM LENA'S REQUEST · 10 AUGUST" — the record this line points at. */
function provenance(e: FeedEntry): string | null {
  if (e.type === "list_reranked") return `From ${first(e.actor.display_name)}'s re-rank · ${when(e.created_at)}`;
  if (e.needs_answer) return `From ${first(e.actor.display_name)}'s ${e.type === "group_invite" ? "invite" : "request"} · ${when(e.created_at)}`;
  return null;
}

/** Read off the timestamp's own date part, never the reader's clock. */
function when(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${String(y).slice(2)}`;
}

const Feed = () => {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .notifications()
      .then((v) => {
        setEntries(v.entries);
        setReachable(true);
      })
      .catch(() => setReachable(false));
  }, []);

  useEffect(load, [load]);

  const accept = async (e: FeedEntry) => {
    setBusy(e.id);
    try {
      await api.acceptFriend(e.subject.friendship_id as string);
      load();
    } catch {
      setReachable(false);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (e: FeedEntry) => {
    setBusy(e.id);
    try {
      await api.markNotificationsRead([e.id]);
      load();
    } finally {
      setBusy(null);
    }
  };

  if (!reachable) {
    return (
      <section data-feed data-state="unreachable" className="mt-8">
        <Nothing
          kicker="Can't reach it"
          title="Cosign can't reach the people part of this page."
          body="Your list is below, and nothing was missed — a line here waits until it is answered."
          action={
            <button type="button" onClick={load} className="cs-pill-ghost">
              Try again
            </button>
          }
        />
      </section>
    );
  }

  if (entries === null) {
    return (
      <section data-feed data-state="loading" className="mt-8">
        <p className="cs-display text-muted">Looking.</p>
      </section>
    );
  }

  const asks = entries.filter((e) => e.needs_answer);
  const news = entries.filter((e) => !e.needs_answer);

  if (entries.length === 0) {
    return (
      <section data-feed data-state="empty" className="mt-8">
        <Nothing
          kicker="Nothing from anybody"
          title="Nobody has needed anything from you."
          body="This page fills up only when a person does something: asks to be friends, says yes, makes you an editor, puts a shared list back in order, or asks what you need tonight. That is the entire list of things that can put a line here — so an empty one means a quiet week, which is most weeks, and is fine."
        />
        <Audit />
      </section>
    );
  }

  return (
    <section data-feed data-asks={asks.length} className="mt-8">
      {asks.length > 0 && (
        <>
          <h2 className="cs-caps text-gold">Waiting on you</h2>
          <p className="cs-display mt-2 text-balance text-2xl text-ink">
            {asks.length === 1 ? "One person is waiting on you." : `${asks.length} people are waiting on you.`}
          </p>
          <p className="mt-2 text-xs text-muted">
            That is the only number Cosign will ever put on a tab. It can't be raised except by a person
            doing something to you, and it can't be lowered by looking — only by answering.
          </p>
          <ul className="mt-5">
            {asks.map((e) => (
              <li key={e.id} data-ask={e.type} className="border-t border-rule py-5 first:border-t-0">
                <p className="cs-caps text-line">
                  {e.actor.display_name} · {when(e.created_at)}
                </p>
                <p className="cs-display mt-2 text-lg text-ink">{title(e)}</p>
                {body(e) && <p className="mt-1 text-sm text-line">{body(e)}</p>}
                {provenance(e) && <p className="cs-caps mt-2 text-muted">{provenance(e)}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  {e.type === "friend_request" ? (
                    <button
                      type="button"
                      data-accept
                      disabled={busy === e.id}
                      onClick={() => accept(e)}
                      className="cs-pill-ghost"
                    >
                      Add {first(e.actor.display_name)}
                    </button>
                  ) : (
                    <Link to={`/g/${e.subject.session_id as string}`} className="cs-pill-ghost">
                      Say what you need
                    </Link>
                  )}
                  <button
                    type="button"
                    data-dismiss
                    disabled={busy === e.id}
                    onClick={() => dismiss(e)}
                    className="cs-word text-sm text-muted underline underline-offset-4"
                  >
                    {e.type === "friend_request" ? "not now" : "not tonight"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {news.length > 0 && (
        <>
          <h2 className={`cs-caps text-gold ${asks.length > 0 ? "mt-10" : ""}`}>Just so you know</h2>
          <p className="mt-2 text-xs text-muted">
            {news.length} {news.length === 1 ? "thing" : "things"} happened that need nothing from you. None
            of them is counted anywhere.
          </p>
          <ul className="mt-4">
            {news.map((e, i) => {
              const day = when(e.created_at);
              const newDay = i === 0 || when(news[i - 1].created_at) !== day;
              return (
                <li key={e.id} data-news={e.type}>
                  {/* The day rule: a right-aligned date per row stops scaling
                      at about ten entries, and this book only ever grows. */}
                  {newDay && (
                    <p className="cs-caps mt-5 border-t border-rule-strong pt-3 text-gold first:mt-0">{day}</p>
                  )}
                  <div className="border-t border-rule py-4 first:border-t-0">
                    <p className="text-sm text-ink">{title(e)}</p>
                    {body(e) && <p className="mt-1 text-xs text-muted">{body(e)}</p>}
                    {provenance(e) && <p className="cs-caps mt-2 text-muted">{provenance(e)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Audit />
    </section>
  );
};

const Audit = () => (
  <div data-audit className="mt-9 border-t border-rule-strong pt-5">
    <h3 className="cs-caps text-gold">Five things can put a line here</h3>
    <ul className="mt-3">
      {FIVE.map((line) => (
        <li key={line} className="border-t border-rule py-3 text-sm text-line first:border-t-0">
          {line}
        </li>
      ))}
    </ul>
    <p className="mt-4 text-xs text-muted">
      Nothing else, and nothing on a clock. There is no streak to keep, nothing to earn, and no evening on
      which Cosign decides you have been away long enough to be reminded of it.
    </p>
  </div>
);

export default Feed;
