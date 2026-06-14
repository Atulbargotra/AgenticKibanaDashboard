import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
vi.mock("../config/env.js", () => ({
    env: {
        ELASTICSEARCH_URL: "http://localhost:9200",
        SERVICE_NAME: "checkout-service",
        DEPLOYMENT_ENVIRONMENT: "local",
        LOGS_INDEX_PATTERN: "logs-springboot-local*",
        PATTERN_WINDOW_MINUTES: 15,
        ERROR_SPIKE_THRESHOLD: 5,
    },
}));
vi.mock("./elasticsearch.js", () => ({
    elasticsearchSearch: vi.fn(),
}));
import { fingerprint } from "../utils/findings.js";
import { extractBody, parseLogEvent, detectExceptionSpikes, } from "./errorSpikeDetector.js";
import { elasticsearchSearch } from "./elasticsearch.js";
const mockedSearch = vi.mocked(elasticsearchSearch);
describe("fingerprint", () => {
    it("produces a 16-char hex string", () => {
        const result = fingerprint(["a", "b", "c"]);
        expect(result).toMatch(/^[0-9a-f]{16}$/);
        expect(result).toHaveLength(16);
    });
    it("is deterministic for the same inputs", () => {
        const a = fingerprint(["exception_spike", "svc", "prod", "NullPointerException"]);
        const b = fingerprint(["exception_spike", "svc", "prod", "NullPointerException"]);
        expect(a).toBe(b);
    });
    it("differs for different inputs", () => {
        const a = fingerprint(["exception_spike", "svc-a"]);
        const b = fingerprint(["exception_spike", "svc-b"]);
        expect(a).not.toBe(b);
    });
    it("matches manual sha256 computation", () => {
        const parts = ["x", "y"];
        const expected = createHash("sha256")
            .update(parts.join("|"))
            .digest("hex")
            .slice(0, 16);
        expect(fingerprint(parts)).toBe(expected);
    });
});
describe("extractBody", () => {
    it("returns body when present", () => {
        const hit = { _source: { body: "error occurred" } };
        expect(extractBody(hit)).toBe("error occurred");
    });
    it("falls back to Body (capital B)", () => {
        const hit = { _source: { Body: "Error from Body" } };
        expect(extractBody(hit)).toBe("Error from Body");
    });
    it("falls back to message", () => {
        const hit = { _source: { message: "log message" } };
        expect(extractBody(hit)).toBe("log message");
    });
    it("returns empty string when _source is undefined", () => {
        const hit = {};
        expect(extractBody(hit)).toBe("");
    });
    it("returns empty string when no fields match", () => {
        const hit = { _source: {} };
        expect(extractBody(hit)).toBe("");
    });
    it("prefers body over Body and message", () => {
        const hit = { _source: { body: "first", Body: "second", message: "third" } };
        expect(extractBody(hit)).toBe("first");
    });
});
describe("parseLogEvent", () => {
    it("extracts exception class from exception.class= pattern", () => {
        const msg = "exception.class=java.lang.NullPointerException at line 42";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.exceptionClass).toBe("java.lang.NullPointerException");
        expect(event.message).toBe(msg);
        expect(event.source).toBe("elasticsearch");
    });
    it("extracts exception class from bare class name", () => {
        const msg = "Caused by: RuntimeException: something broke";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.exceptionClass).toBe("RuntimeException");
    });
    it("extracts service name from bracket pattern", () => {
        const msg = "[payment-service] error processing order";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.serviceName).toBe("payment-service");
    });
    it("falls back to env SERVICE_NAME when not in message", () => {
        const msg = "generic log line";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.serviceName).toBe("checkout-service");
    });
    it("extracts deployment environment", () => {
        const msg = "deployment.environment=staging something happened";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.environment).toBe("staging");
    });
    it("falls back to env DEPLOYMENT_ENVIRONMENT", () => {
        const msg = "no env info here";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.environment).toBe("local");
    });
    it("extracts HTTP 5xx status code", () => {
        const msg = "GET /api/checkout 500 in 123ms";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.statusCode).toBe(500);
    });
    it("extracts status= prefix format", () => {
        const msg = "request failed status=503 ";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.statusCode).toBe(503);
    });
    it("sets statusCode to undefined when no HTTP status", () => {
        const msg = "everything is fine";
        const event = parseLogEvent(msg, "elasticsearch");
        expect(event.statusCode).toBeUndefined();
    });
    it("passes through timestamp", () => {
        const event = parseLogEvent("msg", "elasticsearch", "2024-01-01T00:00:00Z");
        expect(event.timestamp).toBe("2024-01-01T00:00:00Z");
    });
});
describe("detectExceptionSpikes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it("returns empty array when no hits", async () => {
        mockedSearch.mockResolvedValue({ hits: { hits: [] } });
        const findings = await detectExceptionSpikes();
        expect(findings).toEqual([]);
    });
    it("returns empty array when hits is undefined", async () => {
        mockedSearch.mockResolvedValue({});
        const findings = await detectExceptionSpikes();
        expect(findings).toEqual([]);
    });
    it("detects exception spike above threshold", async () => {
        const hits = Array.from({ length: 6 }, (_, i) => ({
            _source: {
                body: `exception.class=NullPointerException at line ${i}`,
                "@timestamp": `2024-01-01T00:0${i}:00Z`,
            },
        }));
        mockedSearch.mockResolvedValue({ hits: { hits } });
        const findings = await detectExceptionSpikes();
        expect(findings).toHaveLength(1);
        expect(findings[0].kind).toBe("exception_spike");
        expect(findings[0].title).toBe("Exception spike: NullPointerException");
        expect(findings[0].severity).toBe("medium");
        expect(findings[0].confidence).toBe(0.86);
        expect(findings[0].source).toBe("elasticsearch");
        expect(findings[0].sampleEvents).toHaveLength(5);
    });
    it("marks high severity when count >= threshold * 3", async () => {
        const hits = Array.from({ length: 16 }, (_, i) => ({
            _source: {
                body: `exception.class=OutOfMemoryError occurred ${i}`,
                "@timestamp": `2024-01-01T00:00:${String(i).padStart(2, "0")}Z`,
            },
        }));
        mockedSearch.mockResolvedValue({ hits: { hits } });
        const findings = await detectExceptionSpikes();
        const finding = findings.find((f) => f.kind === "exception_spike");
        expect(finding?.severity).toBe("high");
    });
    it("ignores exception groups below threshold", async () => {
        const hits = Array.from({ length: 3 }, (_, i) => ({
            _source: {
                body: `exception.class=RareException happened ${i}`,
                "@timestamp": `2024-01-01T00:0${i}:00Z`,
            },
        }));
        mockedSearch.mockResolvedValue({ hits: { hits } });
        const findings = await detectExceptionSpikes();
        expect(findings).toHaveLength(0);
    });
    it("detects HTTP 5xx spike", async () => {
        const hits = Array.from({ length: 6 }, (_, i) => ({
            _source: {
                body: `GET /api/data 500 in ${100 + i}ms`,
                "@timestamp": `2024-01-01T00:0${i}:00Z`,
            },
        }));
        mockedSearch.mockResolvedValue({ hits: { hits } });
        const findings = await detectExceptionSpikes();
        const httpFinding = findings.find((f) => f.kind === "http_5xx_spike");
        expect(httpFinding).toBeDefined();
        expect(httpFinding.title).toBe("HTTP 5xx spike");
        expect(httpFinding.confidence).toBe(0.74);
    });
    it("returns both exception and HTTP 5xx findings when applicable", async () => {
        const exceptionHits = Array.from({ length: 5 }, (_, i) => ({
            _source: {
                body: `exception.class=IOException 500 in line ${i}`,
                "@timestamp": `2024-01-01T00:0${i}:00Z`,
            },
        }));
        mockedSearch.mockResolvedValue({ hits: { hits: exceptionHits } });
        const findings = await detectExceptionSpikes();
        expect(findings.length).toBeGreaterThanOrEqual(2);
        expect(findings.some((f) => f.kind === "exception_spike")).toBe(true);
        expect(findings.some((f) => f.kind === "http_5xx_spike")).toBe(true);
    });
});
