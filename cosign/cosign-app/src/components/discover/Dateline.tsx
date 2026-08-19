import type { SemesterPhase } from "@/types/cosign";
import { phaseLabel } from "@/lib/placeCopy";

/** The line above the question: the masthead, the clock, and the week. */
const Dateline = ({
  now,
  phase,
  semester,
}: {
  now: Date;
  phase: SemesterPhase;
  semester: string;
}) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-4">
    <p className="cs-caps text-gold">Cosign</p>
    <p data-dateline data-phase={phase} className="cs-caps text-right text-muted">
      {now.toLocaleDateString("en-US", { weekday: "long" })} ·{" "}
      {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()} ·{" "}
      <span className="text-line">{phaseLabel(phase, semester)}</span>
    </p>
  </div>
);

export default Dateline;
