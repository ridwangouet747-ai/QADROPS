import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NODE_ENV === "development" && process.env.QADR_PREVIEW_MODE === "true" ? ".next-preview" : ".next",
  outputFileTracingRoot: process.cwd(),
  // PGlite (preview mode only) loads its WASM/data files from `new URL(..., import.meta.url)`; webpack bundling
  // breaks that path ("Received an instance of URL"), so it must be loaded with Node's native resolution.
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
