import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // Every value below reads src/design/tokens.css. Nothing in this file
      // may introduce a colour, size or duration the token file does not
      // name — that is the whole point of committing the token file.
      fontFamily: {
        sans: ["var(--font-body)"],
        serif: ["var(--font-display)"],
        display: ["var(--font-display)"],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["var(--text-2xs)", { lineHeight: "1.4" }],
        xs: ["var(--text-xs)", { lineHeight: "1.45" }],
        sm: ["var(--text-sm)", { lineHeight: "1.5" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-body)" }],
        lg: ["var(--text-lg)", { lineHeight: "var(--leading-snug)" }],
        xl: ["var(--text-xl)", { lineHeight: "var(--leading-snug)" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-tight)" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-tight)" }],
        "4xl": ["var(--text-4xl)", { lineHeight: "var(--leading-tight)" }],
      },
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        // semantic names the product actually speaks in
        ink: "hsl(var(--ink) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        rule: "hsl(var(--rule) / <alpha-value>)",
        "rule-strong": "hsl(var(--rule-strong) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        raise: "hsl(var(--raise) / <alpha-value>)",
        ember: {
          DEFAULT: "hsl(var(--ember) / <alpha-value>)",
          ink: "hsl(var(--ember-ink) / <alpha-value>)",
        },
        gold: "hsl(var(--gold) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          primary: "hsl(var(--sidebar-primary) / <alpha-value>)",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          accent: "hsl(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
        },
      },
      letterSpacing: {
        caps: "var(--tracking-caps)",
        display: "var(--tracking-display)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        in: "var(--ease-in)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        hair: "var(--radius-sm)",
      },
      // There are deliberately no `keyframes`/`animation` entries and no
      // `tailwindcss-animate`. Five Lovable-era animations lived here, under
      // the comment above forbidding exactly them: `accordion-down/up` at
      // 0.2s animating HEIGHT, `slide-up` at 0.3s, `fade-in` at 0.4s, and
      // `shimmer 2s linear infinite` — a perpetual motion no rule in this
      // codebase could stop, because reduced-motion is implemented by zeroing
      // the duration TOKENS and none of those five read a token. It is the
      // same trap CLAUDE.md records for `animate-spin`. Nothing outside the
      // deleted shadcn tree ever used one.
      //
      // Motion belongs to src/index.css, where every duration is
      // `var(--duration-*)` and `src/design/motion.test.ts` fails the suite
      // on a literal time value or an `infinite` anywhere in the CSS layer.
    },
  },
  plugins: [],
} satisfies Config;
