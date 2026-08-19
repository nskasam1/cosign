interface StatementRowProps {
  label: string;
  gloss?: string;
  onSelect: () => void;
  /** Only pass this where a selection persists — the four asks auto-advance,
   *  so nothing on them is ever "pressed", and a stale mark would lie. */
  pressed?: boolean;
  className?: string;
  [key: `data-${string}`]: string | undefined;
}

/**
 * An answer, set in the display face at 23px — the same face as the 34px
 * question above it. That is the single decision that stops this reading as
 * a form: form options are always small body-face controls, and nothing in
 * the shadcn set renders an option this way.
 *
 * A plain button, never role="radio" or a radiogroup: the tap answers and
 * advances in one motion, and this product treats role="radiogroup" as the
 * shape a rating scale arrives in.
 */
const StatementRow = ({ label, gloss, onSelect, pressed, className = "", ...rest }: StatementRowProps) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={pressed}
    className={`cs-row ${gloss ? "py-5" : "py-4"} ${className}`}
    {...rest}
  >
    <span className={`cs-display block text-xl ${pressed ? "text-ink" : "text-line"}`}>{label}</span>
    {gloss && <span className="mt-1 block text-xs text-muted">{gloss}</span>}
  </button>
);

export default StatementRow;
