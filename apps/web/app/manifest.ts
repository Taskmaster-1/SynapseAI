import type { MetadataRoute } from "next";

/** Installable app: Home Screen on iOS and Android, an app window on desktop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Synapse",
    short_name: "Synapse",
    description: "Hand off tasks, watch them happen, approve what acts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F4F1EA",
    theme_color: "#F4F1EA",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [{ name: "Approvals", url: "/approvals" }],
  };
}
