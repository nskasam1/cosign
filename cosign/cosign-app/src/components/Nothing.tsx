import type { ReactNode } from "react";

interface NothingProps {
  /** The small-caps line above it — always says what is missing, never "oops". */
  kicker: string;
  title: string;
  body: string;
  action?: ReactNode;
  /**
   * Set when this IS the page rather than a section of one. A screen whose
   * entire content is an empty state still needs a level-one heading, and
   * eight of them had none: NotFound, group mode, and every "we couldn't
   * read it" branch.
   */
  standalone?: boolean;
}

/**
 * An empty state, set like everything else in this product: a hairline, a
 * small-caps label, a sentence in the display face. Replaces the Phase-1
 * EmptyState, which was a centred icon in a rounded grey square — the single
 * most stock shape in the app, on the screens the brief says to design most
 * carefully (#9: every empty state as carefully as home).
 *
 * There is no icon slot on purpose. Nothing else here has an icon, and an
 * empty state is not the place to introduce one.
 */
const Nothing = ({ kicker, title, body, action, standalone = false }: NothingProps) => {
  const Title = standalone ? "h1" : "p";
  return (
    <div data-nothing className="cs-settle border-t border-rule-strong pt-5">
      <p className="cs-caps text-gold">{kicker}</p>
      <Title className="cs-display mt-3 text-balance text-xl text-ink sm:text-2xl">{title}</Title>
      <p className="mt-2 max-w-[34rem] text-sm text-line">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
};

export default Nothing;
