// The design tokens, written out as literal hex.
//
// `src/design/tokens.css` is the only source of truth for colour, and every
// surface that can read CSS custom properties reads it. Two cannot:
//
//   * satori, which has no custom properties at all (server/pages/og.ts);
//   * an SVG inside an `<img>`, which is a separate document with no access
//     to the page's `:root` — the profile's map is drawn that way because
//     forty-odd inline SVG nodes cost ~520 ms of throttled style and layout
//     on the one page with a hard LCP budget.
//
// So this file is the ONE place a token value is repeated, and
// `src/design/tokens.test.ts` fails the suite the moment it drifts from
// tokens.css. Adding a second copy anywhere else is how a design system
// stops being one.

export const HEX = {
  bg: "#120F0D",
  surface: "#1D1816",
  ink: "#F7F1E9",
  line: "#D5C8B8",
  muted: "#A7998B",
  rule: "#342C27",
  ruleStrong: "#4C4038",
  ember: "#F25B31",
  gold: "#DAB462",
} as const;

/** The six imagery treatments (seed/images/generate.mjs, src/lib/palette.ts). */
export const PAL_HEX: Record<string, string> = {
  warm: "#c8a96e",
  amber: "#d9a441",
  rose: "#c98a7a",
  moss: "#8a9a6e",
  slate: "#7d8a99",
  clay: "#b07a5c",
};

/**
 * Swap `hsl(var(--token))` for the literal colour, for the two renderers
 * that have no custom properties. Anything it does not recognise is left
 * alone rather than silently blanked — an unresolved `var()` draws nothing,
 * and a mark that quietly disappears from a map is the worst failure this
 * page has.
 */
export function resolveTokenColours(svg: string): string {
  return svg
    .replace(/hsl\(var\(--pal-([a-z]+)\)\)/g, (m, key: string) => PAL_HEX[key] ?? m)
    .replace(/hsl\(var\(--rule-strong\)\)/g, HEX.ruleStrong)
    .replace(/hsl\(var\(--([a-z-]+)\)\)/g, (m, key: string) => {
      const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      return (HEX as Record<string, string>)[camel] ?? m;
    });
}
