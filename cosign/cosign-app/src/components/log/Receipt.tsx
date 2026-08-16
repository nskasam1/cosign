export interface ReceiptItem {
  /** `known` = what Cosign worked out on its own; `said` = what you told it. */
  kind: "known" | "said";
  text: string;
}

interface ReceiptProps {
  items: ReceiptItem[];
  timeBucket?: string;
  semester?: string;
}

/**
 * The running record of the log, one small-caps line under the header. It is
 * already half-written before the first tap — time of day, term, walk — in
 * muted, because that is what Cosign knew; every answer lands on the end of
 * it in gold, because that is what you said. One colour rule does the whole
 * job of showing that time_bucket and semester are captured, not asked.
 *
 * The height is reserved for three lines from the first render: this sits
 * above the question on every step, and a receipt that grew would push the
 * answers down under the user's thumb mid-flow.
 */
const Receipt = ({ items, timeBucket, semester }: ReceiptProps) => (
  <p
    data-receipt
    data-time-bucket={timeBucket}
    data-semester={semester}
    role="status"
    aria-live="polite"
    className="cs-caps min-h-[54px] text-muted"
  >
    {items.map((item, i) => (
      <span key={`${item.kind}-${item.text}`} data-receipt-item={item.kind}>
        {i > 0 && <span className="text-rule-strong"> · </span>}
        <span className={item.kind === "said" ? "text-gold" : undefined}>{item.text}</span>
      </span>
    ))}
  </p>
);

export default Receipt;
