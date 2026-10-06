import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["scripts/bake-og-image.cjs"],
    // CommonJS scripts use require() by definition; application TS stays ESM.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      // These rules target React Compiler adoption. The app still runs on
      // supported React 18, where effects intentionally hydrate browser and
      // network state. Keep the core hooks rules while avoiding a risky,
      // behavior-changing rewrite as part of the Next.js security upgrade.
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-casa-local-*/**",
    "android/**",
    "coverage/**",
    "design-handoff/**",
    "ios/**",
    "public/**",
    "test-results/**",
  ]),
]);
