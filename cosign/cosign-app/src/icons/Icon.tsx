import { PATHS, STROKE, VIEW_BOX, type IconName } from "./paths";

export interface IconProps {
  name: IconName;
  /** Rendered size in px. 20 in meta strips, 24 in the tab bar, 28 in the FAB. */
  size?: number;
  className?: string;
  /**
   * An icon that carries meaning needs a name; an icon beside its own label is
   * decoration and must be hidden, or a screen reader reads everything twice.
   * There is no third option, so the prop is required by omission: pass a
   * label, or don't and get `aria-hidden`.
   */
  label?: string;
  strokeWidth?: number;
}

/**
 * The whole icon layer. One component, one grid, one stroke weight.
 *
 * `currentColor` throughout, so an icon takes the colour of the text it sits
 * with and there is no way to give one a colour the design system has not
 * already decided. Sizes are px rather than `em` because these sit next to
 * 11px small-caps labels and 28px numerals in the same bar, and inheriting from
 * font-size would make the bar ragged.
 */
const Icon = ({ name, size = 24, className, label, strokeWidth = STROKE }: IconProps) => (
  <svg
    viewBox={VIEW_BOX}
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    // Non-scaling stroke would keep hairlines crisp but makes a 20px and a 28px
    // icon visually different weights; the family reads as one set only if the
    // stroke scales with the glyph.
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    focusable="false"
  >
    <path d={PATHS[name]} />
  </svg>
);

export default Icon;
export { PATHS, type IconName };
