import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MetadataRoute } from "next";

const TERMINAL_BG_PATTERN = /--terminal-bg:\s*(#[0-9a-fA-F]{3,8})/;

/**
 * Resolves the dark-theme base color from globals.css at build time so the
 * manifest cannot drift from --terminal-bg when the palette changes. The first
 * match is the :root (dark) value; the .light override appears later in the file.
 */
function getTerminalBaseColor() {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const match = css.match(TERMINAL_BG_PATTERN);

  if (!match?.[1]) {
    throw new Error("Unable to resolve --terminal-bg from app/globals.css for the web manifest.");
  }

  return match[1];
}

export default function manifest(): MetadataRoute.Manifest {
  const baseColor = getTerminalBaseColor();

  return {
    background_color: baseColor,
    description: "A dark trading terminal interface mockup built with Next.js.",
    display: "standalone",
    icons: [
      {
        sizes: "any",
        src: "/favicon.ico",
        type: "image/x-icon",
      },
    ],
    name: "Numo",
    short_name: "Numo",
    start_url: "/",
    theme_color: baseColor,
  };
}
