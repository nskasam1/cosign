import "@testing-library/jest-dom";

// jsdom-only shims. This setup file also runs for tests that opt into the
// node environment (`// @vitest-environment node`), where window is absent.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
