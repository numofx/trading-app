import "server-only";
import { PostHog } from "posthog-node";

export function getPostHogClient() {
  return new PostHog(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ?? "", {
    flushAt: 1,
    flushInterval: 0,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}
