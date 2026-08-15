import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import EmptyState from "@/components/EmptyState";

// Group decision mode returns in Phase 5B, redesigned per the brief: the
// intersection of up to four people's needs (intent + constraints against
// each member's ranked list) — not voting. The old thumbs-up/down flow was
// a banned input class and is deleted, not preserved.
const GroupSession = () => (
  <div className="min-h-screen flex items-center justify-center">
    <EmptyState
      icon={<Users className="w-6 h-6" />}
      title="Group mode is brewing"
      description="Four people, one table that works for everyone. This comes back once ranking and logging are in — no voting, just needs."
      action={<Link to="/" className="text-sm text-primary font-semibold">Back home</Link>}
    />
  </div>
);

export default GroupSession;
