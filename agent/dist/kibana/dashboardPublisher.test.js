import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("../config/env.js", () => ({
    env: {
        KIBANA_URL: "http://localhost:5601",
        KIBANA_SPACE: "default",
        AGENT_DRY_RUN: true,
        AGENT_REQUIRE_REVIEW: false,
        LOGS_DATA_VIEW_TITLE: "logs-springboot-local*",
        METRICS_DATA_VIEW_TITLE: "metrics-springboot-local*",
        TRACES_DATA_VIEW_TITLE: "traces-springboot-local*",
    },
}));
vi.mock("./client.js", () => ({
    kibanaRequest: vi.fn(),
}));
import { buildVisualizationState, readRegistry, writeRegistry, dashboardExists, publishDashboardDraft, } from "./dashboardPublisher.js";
import { kibanaRequest } from "./client.js";
const mockedKibanaRequest = vi.mocked(kibanaRequest);
const registryPath = resolve(process.cwd(), ".dashboard-registry.json");
function cleanupRegistry() {
    try {
        unlinkSync(registryPath);
    }
    catch {
        // ignore if not found
    }
}
describe("buildVisualizationState", () => {
    it("returns a metric visualization with count agg", () => {
        const state = buildVisualizationState("Error Count", "metric");
        expect(state.type).toBe("metric");
        expect(state.title).toBe("Error Count");
        expect(state.params).toBeDefined();
        const params = state.params;
        expect(params.type).toBe("metric");
        expect(state.aggs).toHaveLength(1);
        const aggs = state.aggs;
        expect(aggs[0].type).toBe("count");
    });
    it("returns a line chart for timeseries", () => {
        const state = buildVisualizationState("Error Trend", "timeseries");
        expect(state.type).toBe("line");
        expect(state.aggs).toHaveLength(2);
        const aggs = state.aggs;
        expect(aggs[0].type).toBe("count");
        expect(aggs[1].type).toBe("date_histogram");
    });
    it("returns a histogram for bar without breakdown", () => {
        const state = buildVisualizationState("Bar Chart", "bar");
        expect(state.type).toBe("histogram");
        const aggs = state.aggs;
        expect(aggs[1].type).toBe("date_histogram");
    });
    it("returns a histogram with terms agg for bar with breakdown", () => {
        const state = buildVisualizationState("By Service", "bar", "service.name");
        expect(state.type).toBe("histogram");
        const aggs = state.aggs;
        expect(aggs[1].type).toBe("terms");
        const params = aggs[1].params;
        expect(params.field).toBe("service.name");
    });
});
describe("readRegistry / writeRegistry", () => {
    beforeEach(cleanupRegistry);
    afterEach(cleanupRegistry);
    it("returns empty object when file does not exist", () => {
        expect(readRegistry()).toEqual({});
    });
    it("round-trips a registry entry", () => {
        const data = {
            key1: {
                dashboardId: "dash-001",
                title: "Test Dashboard",
                updatedAt: "2024-01-01T00:00:00.000Z",
            },
        };
        writeRegistry(data);
        expect(readRegistry()).toEqual(data);
    });
    it("returns empty object when registry has invalid JSON", () => {
        writeFileSync(registryPath, "not-json!!!");
        expect(readRegistry()).toEqual({});
    });
});
describe("dashboardExists", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it("returns true when a matching dashboard is found", async () => {
        mockedKibanaRequest.mockResolvedValue({
            saved_objects: [
                { id: "dash-1", attributes: { title: "My Dashboard" } },
                { id: "dash-2", attributes: { title: "Other" } },
            ],
        });
        expect(await dashboardExists("My Dashboard")).toBe(true);
    });
    it("returns false when no matching title", async () => {
        mockedKibanaRequest.mockResolvedValue({
            saved_objects: [
                { id: "dash-1", attributes: { title: "Other Dashboard" } },
            ],
        });
        expect(await dashboardExists("My Dashboard")).toBe(false);
    });
    it("returns false when no saved objects", async () => {
        mockedKibanaRequest.mockResolvedValue({ saved_objects: [] });
        expect(await dashboardExists("Any")).toBe(false);
    });
});
describe("publishDashboardDraft", () => {
    const finding = {
        id: "exception-spike:svc:env:NPE",
        fingerprint: "fp_test_123",
        kind: "exception_spike",
        title: "Exception spike: NPE",
        serviceName: "checkout-service",
        environment: "local",
        severity: "medium",
        confidence: 0.86,
        timeRangeMinutes: 15,
        source: "elasticsearch",
        matchingQuery: 'message: "*NPE*"',
        sampleEvents: [],
        evidence: {},
    };
    const plan = {
        shouldCreate: true,
        stableKey: "fp_test_123",
        reason: "Test reason",
        dashboardTitle: "Test Dashboard",
        template: "exception-spike",
        tags: ["test"],
        filters: {},
        panels: [
            { title: "P1", purpose: "p", query: "*", visualization: "table", dataView: "logs" },
            { title: "P2", purpose: "p", query: "*", visualization: "metric", dataView: "logs" },
        ],
        dedupe: { strategy: "upsert", key: "fp_test_123" },
        lifecycle: { owner: "test", ttlDays: 7, reviewRequired: false },
    };
    beforeEach(() => {
        vi.clearAllMocks();
        cleanupRegistry();
    });
    afterEach(cleanupRegistry);
    it("logs plan in dry-run mode without calling Kibana", async () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
        await publishDashboardDraft(finding, plan);
        expect(mockedKibanaRequest).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[dry-run]"), expect.any(String));
        logSpy.mockRestore();
    });
});
