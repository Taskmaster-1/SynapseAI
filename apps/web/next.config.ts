import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:8787";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @synapse/core ships TypeScript source.
  transpilePackages: ["@synapse/core"],
  async rewrites() {
    // Same-origin proxy so Better Auth session cookies work without CORS.
    return [
      { source: "/api/:path*", destination: `${apiUrl}/api/:path*` },
      { source: "/oauth/:path*", destination: `${apiUrl}/oauth/:path*` },
    ];
  },
};

export default config;
