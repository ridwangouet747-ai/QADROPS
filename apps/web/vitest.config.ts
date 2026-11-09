import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    // Les beforeAll appliquent les 24 migrations à une base PGlite neuve : sous charge (mission 14, deux suites
    // en parallèle), cela dépasse 30 s. Les tests eux-mêmes gardent 30 s.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
