import { Link } from "react-router-dom";
import { useTitle } from "@/lib/title";
import Nothing from "@/components/Nothing";

// Group decision mode returns in Phase 5B, redesigned per the brief: the
// intersection of up to four people's needs (intent + constraints against
// each member's ranked list) — not voting. The old thumbs-up/down flow was
// a banned input class and is deleted, not preserved.
const GroupSession = () => {
  useTitle("Group mode");
  return (
    <main className="cs-wrap flex min-h-dvh flex-col justify-center pb-10">
      <Nothing
        kicker="Not yet"
        standalone
        title="Four people, one table that works for all of them."
        body="Group mode comes back once ranking and logging are in. It will ask what each person needs and find the overlap — nobody votes, because a vote is a rating with extra steps."
        action={
          <Link to="/" className="cs-pill-ghost">
            Back home
          </Link>
        }
      />
    </main>
  );
};

export default GroupSession;
