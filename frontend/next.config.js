/** @type {import('next').NextConfig} */
const nextConfig = {
  // Rewrite /api/backend/* → http://localhost:8000/* in development
  // This avoids CORS entirely for local dev.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/backend/:path*",
        destination: "http://localhost:8000/:path*",
      },
    ];
  },
  // Allow images from Supabase storage
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
  },
  // Strict mode for better dev warnings
  reactStrictMode: true,
};

module.exports = nextConfig;
