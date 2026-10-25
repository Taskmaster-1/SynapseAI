import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:8787";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @synapse/core ships TypeScript source.
  transpilePackages: ["@synapse/core"],
  async headers() {
    return [
      {
        // Browsers must always fetch the latest worker; it only ever runs our own code.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  async rewrites() {
    // Same-origin proxy so Better Auth session cookies work without CORS.
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/oauth/:path*", destination: `${apiUrl}/oauth/:path*` },
    ];
  },
};

export default config;
