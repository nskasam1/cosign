import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Move focus to the new page's title when the route changes.
 *
 * Without it, tapping a word on the shelf swaps the whole document and leaves
 * focus exactly where it was — on the tab. A sighted person sees a new page;
 * somebody on a screen reader hears nothing and is still standing on "Search"
 * while Search is already on screen. `StepTitle` in the log flow has done this
 * for its own steps since Phase 3 and was the only surface in the app that did.
 *
 * **This must be rendered ONCE, inside the router and outside `<Routes>`, and
 * that is the whole reason it is not a hook inside `AppShell`.** It was, for
 * about an hour, and it half worked in a way no unit test would have caught:
 * `AppShell` is instantiated separately by each `<Route element>`, so React
 * reuses one instance only while the surrounding structure matches. `/`, `/search`
 * and `/rank` are all `<RequireAuth><AppShell>` and reconcile to the same
 * instance — so the effect fired and focus moved. `/:username` is a bare
 * `<AppShell>` with no `RequireAuth`, and `*` has no shell at all, so both
 * MOUNT a fresh one, the "skip the first render" guard re-arms, and focus is
 * silently never moved. Measured on the running app, focus one second after
 * tapping Search: from `/` H1, from `/rank` H1, from `/maya` body, from a 404
 * body. Living outside `<Routes>` it never unmounts, so the guard means what it
 * says — and it now also covers the journeys, which have no shell to hang it on.
 *
 * The guard itself is deliberate: on a cold load the browser's own focus and
 * scroll position are already right, and stealing them is its own bug.
 * `preventScroll` for the same reason — this is about where reading starts,
 * not where the viewport sits.
 */
const RouteFocus = () => {
  const { pathname } = useLocation();
  const booted = useRef(false);

  useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    // The heading if there is one, the landmark if there is not. Read after
    // the commit that the pathname change caused, so the new page is up.
    const target =
      document.querySelector<HTMLElement>("main h1") ??
      document.querySelector<HTMLElement>("main");
    if (!target) return;
    // A heading is not focusable on its own; -1 makes it programmatically
    // focusable without adding a tab stop, exactly as StepTitle does.
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }, [pathname]);

  return null;
};

export default RouteFocus;
