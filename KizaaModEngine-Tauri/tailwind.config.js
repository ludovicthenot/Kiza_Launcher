/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // The launcher's face, or the one a theme chose (`--kiza-font`). `font-sans`
      // is on the app's root, so this is what nearly everything is set in.
      fontFamily: {
        sans: ['var(--kiza-font, "Segoe UI", "Inter", system-ui, sans-serif)'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // One motion vocabulary. The built-in ease-out and ease-in-out are too
      // soft to read as deliberate; these replace them everywhere they are
      // used, for transitions and for tailwindcss-animate's enter/exit alike.
      transitionTimingFunction: {
        DEFAULT: "var(--ease-out)",
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        drawer: "var(--ease-drawer)",
        spring: "var(--ease-spring)",
      },
      animationTimingFunction: {
        DEFAULT: "var(--ease-out)",
        out: "var(--ease-out)",
        "in-out": "var(--ease-in-out)",
        drawer: "var(--ease-drawer)",
        spring: "var(--ease-spring)",
      },
      transitionDuration: {
        DEFAULT: "200ms",
        sheet: "260ms",
      },
      animationDuration: {
        DEFAULT: "200ms",
        sheet: "260ms",
      },
    },
  },
  future: {
    // A tap on a touch screen is not a hover.
    hoverOnlyWhenSupported: true,
  },
  plugins: [require("tailwindcss-animate")],
}