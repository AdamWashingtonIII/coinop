import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: { colors: { neon: "#39ffdc", magenta2: "#ff2ea6", cabinet: "#0b0b14" } } },
  plugins: [],
} satisfies Config;
