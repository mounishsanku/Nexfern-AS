import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vite client build output (when running root eslint)
    "client/dist/**",
    "dist/**",
    // Vite SPA lives under `client/` and uses `client/eslint.config.js`
    "client/**",
    // Node scripts use CommonJS; lint separately if needed
    "scripts/**",
    // Express API has its own tooling under `server/`
    "server/**",
  ]),
]);

export default eslintConfig;
