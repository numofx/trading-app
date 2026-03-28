import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#0C141E",
    description: "A dark trading terminal interface mockup built with Next.js.",
    display: "standalone",
    icons: [
      {
        sizes: "any",
        src: "/favicon.ico",
        type: "image/x-icon",
      },
    ],
    name: "Trading Terminal",
    short_name: "Trading Terminal",
    start_url: "/",
    theme_color: "#0C141E",
  };
}
