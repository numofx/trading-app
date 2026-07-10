import "server-only";

import { Duration } from "effect";
import type { StrailsBookStatus } from "@/lib/strails.types";

// While degraded, re-log periodically so a persistent outage stays visible in
// log-based alerting without emitting a line on every 6-second poll.
const DEGRADED_REMINDER_INTERVAL_MS = Duration.toMillis("10 minutes");

// Statuses that are expected fallback states rather than upstream problems.
const QUIET_STATUSES = new Set<StrailsBookStatus>(["ok", "unconfigured"]);

type StrailsStatusState = {
  count: number;
  firstSeenAt: number;
  lastLoggedAt: number;
  status: StrailsBookStatus | null;
};

// Per-server-instance state; on multi-instance deployments each instance logs
// its own transitions, which is sufficient for log-based alerting.
let state: StrailsStatusState = { count: 0, firstSeenAt: 0, lastLoggedAt: 0, status: null };

/**
 * Records the outcome of a strails orderbook poll and logs with the stable
 * `strails-orderbook` prefix on status transitions, plus periodic reminders
 * while degraded. Grep/alert on `strails-orderbook` in server logs.
 */
export function recordStrailsBookStatus(status: StrailsBookStatus, detail?: string) {
  const now = Date.now();
  const suffix = detail ? ` (${detail})` : "";

  if (status !== state.status) {
    const previous = state.status;
    state = { count: 1, firstSeenAt: now, lastLoggedAt: now, status };

    if (QUIET_STATUSES.has(status)) {
      console.info(`strails-orderbook status: ${status}${previous ? ` (was ${previous})` : ""}${suffix}`);
    } else {
      console.warn(`strails-orderbook degraded: ${status}${suffix}`);
    }

    return;
  }

  state.count += 1;

  if (!QUIET_STATUSES.has(status) && now - state.lastLoggedAt >= DEGRADED_REMINDER_INTERVAL_MS) {
    state.lastLoggedAt = now;
    const minutesDegraded = Math.round((now - state.firstSeenAt) / Duration.toMillis("1 minute"));
    console.warn(
      `strails-orderbook still ${status} after ${state.count} polls over ~${minutesDegraded} min${suffix}`
    );
  }
}
