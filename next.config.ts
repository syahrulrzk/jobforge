import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Browser automation + proxy dispatcher must load from node_modules at
  // runtime — bundling playwright/undici breaks native process spawning.
  serverExternalPackages: ["playwright", "undici"],
};

export default nextConfig;
