import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ThumbsUp, ThumbsDown, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getParticipantToken } from "@/lib/participantToken";
import type { GroupSession as GroupSessionT, GroupSessionVote, Shop } from "@/types/cosign";
import EmptyState from "@/components/EmptyState";

// Phase 4.1 — group decision mode. Deliberately no auth check on this
// route: per the brief, invitees vote via the link with no login wall.
// Resolution is server-enforced by a trigger on group_session_votes
// (see the Phase 1 migration), not trusted from this client.
const GroupSession = () => {
  const { sessionId } = useParams();
  const [session, setSession] = useState<GroupSessionT | null>(null);
  const [candidates, setCandidates] = useState<Shop[]>([]);
  const [votes, setVotes] = useState<GroupSessionVote[]>([]);
  const [loading, setLoading] = useState(true);
  const token = getParticipantToken();

  const load = useCallback(async () => {
    if (!sessionId) return;
    const { data: sessionData } = await supabase.from("group_sessions").select("*").eq("id", sessionId).single();
    const s = sessionData as GroupSessionT | null;
    setSession(s);

    if (s) {
      const { data: shopRows } = await supabase.from("shops").select("*").in("id", s.shop_candidates);
      setCandidates((shopRows ?? []) as Shop[]);
      const { data: voteRows } = await supabase.from("group_session_votes").select("*").eq("session_id", sessionId);
      setVotes((voteRows ?? []) as GroupSessionVote[]);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  const castVote = async (shopId: string, vote: "up" | "down") => {
    if (!sessionId) return;
    await supabase.from("group_session_votes").upsert(
      { session_id: sessionId, participant_token: token, shop_id: shopId, vote },
      { onConflict: "session_id,participant_token,shop_id" }
    );
    load();
  };

  const myVoteFor = (shopId: string) => votes.find((v) => v.participant_token === token && v.shop_id === shopId)?.vote;
  const upCount = (shopId: string) => votes.filter((v) => v.shop_id === shopId && v.vote === "up").length;

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!session) {
    return (
      <EmptyState
        icon={<Users className="w-6 h-6" />}
        title="Session not found"
        description="This group decision may have been closed or the link is broken."
        action={<Link to="/" className="text-sm text-primary font-semibold">Back home</Link>}
      />
    );
  }

  if (session.status === "resolved" && session.resolved_shop_id) {
    const winner = candidates.find((c) => c.id === session.resolved_shop_id);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-2">
        <span className="text-sm text-muted-foreground">The group picked</span>
        <h1 className="text-3xl font-black text-foreground">{winner?.name ?? "…"}</h1>
        <Link to={`/shop/${session.resolved_shop_id}`} className="text-sm font-semibold text-primary mt-2">
          View shop
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-10">
      <div className="px-5 pt-8 pb-2">
        <h1 className="text-xl font-black text-foreground">Where should we go?</h1>
        <p className="text-sm text-muted-foreground">Vote on the options below.</p>
      </div>
      <div className="flex flex-col gap-3 px-5 mt-4">
        {candidates.map((shop) => {
          const mine = myVoteFor(shop.id);
          return (
            <div key={shop.id} className="rounded-2xl bg-card border border-border p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-foreground">{shop.name}</div>
                <div className="text-xs text-muted-foreground">{upCount(shop.id)} up</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => castVote(shop.id, "up")}
                  className={`p-2 rounded-full ${mine === "up" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}
                >
                  <ThumbsUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => castVote(shop.id, "down")}
                  className={`p-2 rounded-full ${mine === "down" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}
                >
                  <ThumbsDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GroupSession;
