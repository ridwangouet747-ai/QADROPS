import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    files: ["**/*.{js,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    plugins: { "@next/next": nextPlugin },
    rules: nextPlugin.configs.recommended.rules,
  },
  globalIgnores([".next/**", ".next-preview/**", "out/**", "build/**", "next-env.d.ts"]),
]);
