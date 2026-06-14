import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
vi.mock("../config/env.js", () => ({
    env: {
        OPENROUTER_API_KEY: undefined,
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        OPENROUTER_MODEL: "openrouter/free",
        ALLOW_DETERMINISTIC_FALLBACK: false,
        AGENT_REQUIRE_REVIEW: false,
        DEBUG_LLM_IO: false,
        LOGS_DATA_VIEW_TITLE: "logs-springboot-local*",
        METRICS_DATA_VIEW_TITLE: "metrics-springboot-local*",
        TRACES_DATA_VIEW_TITLE: "traces-springboot-local*",
    },
}));
import { extractJson, summarizePlannerFailure, conciseReason, fallbackOrSkip, planDashboard, } from "./dashboardPlanner.js";
import { env } from "../config/env.js";
function makeFinding(overrides = {}) {
    return {
        id: "exception-spike:checkout-service:local:NullPointerException",
        fingerprint: "abc123def456gh78",
        kind: "exception_spike",
        title: "Exception spike: NullPointerException",
        serviceName: "checkout-service",
        environment: "local",
        severity: "medium",
        confidence: 0.86,
        timeRangeMinutes: 15,
        source: "elasticsearch",
        matchingQuery: 'message: "*NullPointerException*"',
        sampleEvents: [{ timestamp: "2024-01-01T00:00:00Z", message: "NPE at line 42" }],
        evidence: { exceptionClass: "NullPointerException", count: 10, threshold: 5 },
        ...overrides,
    };
}
describe("extractJson", () => {
    it("parses raw JSON object", () => {
        const input = '{"key": "value"}';
        expect(extractJson(input)).toEqual({ key: "value" });
    });
    it("parses JSON with leading/trailing whitespace", () => {
        const input = '   {"key": 42}   ';
        expect(extractJson(input)).toEqual({ key: 42 });
    });
    it("extracts JSON from fenced code block", () => {
        const input = '```json\n{"key": "value"}\n```';
        expect(extractJson(input)).toEqual({ key: "value" });
    });
    it("extracts JSON from fenced block without json tag", () => {
        const input = '```\n{"key": "value"}\n```';
        expect(extractJson(input)).toEqual({ key: "value" });
    });
    it("extracts JSON embedded in surrounding text", () => {
        const input = 'Here is the plan: {"shouldCreate": true} - end';
        expect(extractJson(input)).toEqual({ shouldCreate: true });
    });
    it("throws when no JSON found", () => {
        expect(() => extractJson("no json here")).toThrow("Planner response did not contain JSON");
    });
    it("throws on invalid JSON inside braces", () => {
        expect(() => extractJson("{not valid json}")).toThrow();
    });
});
describe("summarizePlannerFailure", () => {
    it("formats ZodError issues", () => {
        const schema = z.object({ name: z.string().min(3) });
        let error;
        try {
            schema.parse({ name: "" });
        }
        catch (e) {
            error = e;
        }
        const result = summarizePlannerFailure(error);
        expect(result).toContain("name:");
    });
    it("returns Error.message for normal errors", () => {
        const result = summarizePlannerFailure(new Error("network timeout"));
        expect(result).toBe("network timeout");
    });
    it("stringifies non-Error values", () => {
        expect(summarizePlannerFailure(42)).toBe("42");
        expect(summarizePlannerFailure("oops")).toBe("oops");
        expect(summarizePlannerFailure(null)).toBe("null");
    });
});
describe("conciseReason", () => {
    it("returns short reasons as-is (normalized)", () => {
        expect(conciseReason("  model  failed  ")).toBe("model failed");
    });
    it("replaces 429 errors with a friendly message", () => {
        expect(conciseReason("HTTP 429 Too Many Requests")).toBe("AI planner was rate limited by the upstream model provider");
    });
    it("truncates reasons longer than 220 characters", () => {
        const longReason = "x".repeat(300);
        const result = conciseReason(longReason);
        expect(result).toHaveLength(220);
        expect(result.endsWith("...")).toBe(true);
    });
    it("does not truncate reasons at exactly 220 characters", () => {
        const reason = "a".repeat(220);
        expect(conciseReason(reason)).toHaveLength(220);
        expect(conciseReason(reason).endsWith("...")).toBe(false);
    });
});
describe("fallbackOrSkip", () => {
    it("returns shouldCreate=false when ALLOW_DETERMINISTIC_FALLBACK is false", () => {
        const finding = makeFinding();
        const plan = fallbackOrSkip(finding, "no API key");
        expect(plan.shouldCreate).toBe(false);
        expect(plan.reason).toContain("fail-closed production mode");
        expect(plan.stableKey).toBe(finding.fingerprint);
        expect(plan.panels).toHaveLength(2);
    });
    it("returns shouldCreate=true when ALLOW_DETERMINISTIC_FALLBACK is true", () => {
        const mockedEnv = env;
        mockedEnv.ALLOW_DETERMINISTIC_FALLBACK = true;
        const finding = makeFinding();
        const plan = fallbackOrSkip(finding, "no API key");
        expect(plan.shouldCreate).toBe(true);
        expect(plan.reason).toContain("Deterministic fallback");
        expect(plan.template).toBe("exception-spike");
        expect(plan.panels.length).toBeGreaterThanOrEqual(3);
        expect(plan.tags).toContain("ai-generated");
        expect(plan.tags).toContain(finding.environment);
        mockedEnv.ALLOW_DETERMINISTIC_FALLBACK = false;
    });
    it("uses finding fingerprint for dedupe key", () => {
        const mockedEnv = env;
        mockedEnv.ALLOW_DETERMINISTIC_FALLBACK = true;
        const finding = makeFinding({ fingerprint: "custom_fp_12345" });
        const plan = fallbackOrSkip(finding, "reason");
        expect(plan.dedupe.key).toBe("custom_fp_12345");
        expect(plan.stableKey).toBe("custom_fp_12345");
        mockedEnv.ALLOW_DETERMINISTIC_FALLBACK = false;
    });
});
describe("planDashboard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it("falls back when no API key is set", async () => {
        const finding = makeFinding();
        const plan = await planDashboard(finding);
        expect(plan.shouldCreate).toBe(false);
        expect(plan.reason).toContain("OpenRouter API key is not configured");
    });
});
