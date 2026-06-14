import { createHash } from "node:crypto";
import { env } from "../config/env.js";
export function fingerprint(parts) {
    return createHash("sha256")
        .update(parts.join("|"))
        .digest("hex")
        .slice(0, 16);
}
export function sampleEvents(events, limit = 5) {
    return events.slice(0, limit).map((e) => ({
        timestamp: e.timestamp,
        message: e.message,
    }));
}
export function spikeSeverity(count) {
    return count >= env.ERROR_SPIKE_THRESHOLD * 3 ? "high" : "medium";
}
