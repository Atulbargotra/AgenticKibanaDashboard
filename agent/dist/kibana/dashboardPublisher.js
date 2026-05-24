import { env } from "../config/env.js";
import { kibanaRequest } from "./client.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const registryPath = resolve(process.cwd(), ".dashboard-registry.json");
function readRegistry() {
    if (!existsSync(registryPath)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(registryPath, "utf8"));
    }
    catch {
        return {};
    }
}
function writeRegistry(registry) {
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}
export async function dashboardExists(title) {
    const result = await kibanaRequest(`/api/saved_objects/_find?type=dashboard&search_fields=title&search=${encodeURIComponent(title)}`, { method: "GET" });
    return result.saved_objects.some((obj) => obj.attributes?.title === title);
}
async function getSavedObjectByExactTitle(type, title) {
    const result = await kibanaRequest(`/api/saved_objects/_find?type=${encodeURIComponent(type)}&search_fields=title&search=${encodeURIComponent(title)}&per_page=100`, { method: "GET" });
    const exact = result.saved_objects.find((obj) => obj.attributes?.title === title);
    return exact ? { id: exact.id } : null;
}
async function resolveDataViewId(dataView) {
    const result = await kibanaRequest("/api/data_views", {
        method: "GET"
    });
    const titleByKind = {
        logs: env.LOGS_DATA_VIEW_TITLE,
        metrics: env.METRICS_DATA_VIEW_TITLE,
        traces: env.TRACES_DATA_VIEW_TITLE
    };
    const match = result.data_view.find((dv) => dv.title === titleByKind[dataView]);
    if (!match) {
        throw new Error(`${titleByKind[dataView]} data view not found`);
    }
    return match.id;
}
async function upsertSearchObject(title, query, columns, dataViewId) {
    const body = {
        attributes: {
            title,
            description: "AI generated search panel",
            columns,
            sort: [["@timestamp", "desc"]],
            kibanaSavedObjectMeta: {
                searchSourceJSON: JSON.stringify({
                    query: { language: "kuery", query },
                    filter: [],
                    indexRefName: "kibanaSavedObjectMeta.searchSourceJSON.index"
                })
            }
        },
        references: [{ name: "kibanaSavedObjectMeta.searchSourceJSON.index", type: "index-pattern", id: dataViewId }]
    };
    const existing = await getSavedObjectByExactTitle("search", title);
    if (existing) {
        await kibanaRequest(`/api/saved_objects/search/${existing.id}`, { method: "PUT", body });
        return existing.id;
    }
    const response = await kibanaRequest("/api/saved_objects/search", { method: "POST", body });
    return response.id;
}
function buildVisualizationState(title, visualization, breakdownField) {
    if (visualization === "metric") {
        return {
            title,
            type: "metric",
            params: {
                addTooltip: true,
                addLegend: false,
                metric: {
                    percentageMode: false,
                    useRanges: false,
                    colorSchema: "Green to Red",
                    metricColorMode: "None",
                    labels: { show: true },
                    style: { bgFill: "#000", bgColor: false, labelColor: false, subText: "matching events" }
                },
                type: "metric"
            },
            aggs: [{ id: "1", enabled: true, type: "count", schema: "metric", params: {} }]
        };
    }
    const chartType = visualization === "bar" ? "histogram" : "line";
    const segmentAgg = visualization === "bar" && breakdownField
        ? {
            id: "2",
            enabled: true,
            type: "terms",
            schema: "segment",
            params: { field: breakdownField, orderBy: "1", order: "desc", size: 10, otherBucket: false, missingBucket: false }
        }
        : {
            id: "2",
            enabled: true,
            type: "date_histogram",
            schema: "segment",
            params: { field: "@timestamp", interval: "auto", min_doc_count: 1, extended_bounds: {} }
        };
    return {
        title,
        type: chartType,
        params: {
            type: chartType,
            addTooltip: true,
            addLegend: true,
            legendPosition: "right",
            times: [],
            addTimeMarker: false
        },
        aggs: [{ id: "1", enabled: true, type: "count", schema: "metric", params: {} }, segmentAgg]
    };
}
async function upsertVisualizationObject(title, query, visualization, dataViewId, breakdownField) {
    const body = {
        attributes: {
            title,
            description: "AI generated visualization panel",
            visState: JSON.stringify(buildVisualizationState(title, visualization, breakdownField)),
            uiStateJSON: "{}",
            version: 1,
            kibanaSavedObjectMeta: {
                searchSourceJSON: JSON.stringify({
                    query: { language: "kuery", query },
                    filter: [],
                    indexRefName: "kibanaSavedObjectMeta.searchSourceJSON.index"
                })
            }
        },
        references: [{ name: "kibanaSavedObjectMeta.searchSourceJSON.index", type: "index-pattern", id: dataViewId }]
    };
    const existing = await getSavedObjectByExactTitle("visualization", title);
    if (existing) {
        await kibanaRequest(`/api/saved_objects/visualization/${existing.id}`, { method: "PUT", body });
        return existing.id;
    }
    const response = await kibanaRequest("/api/saved_objects/visualization", { method: "POST", body });
    return response.id;
}
async function buildDashboardContent(finding, plan) {
    const references = [];
    const panels = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < plan.panels.length; i++) {
        const panel = plan.panels[i];
        const dataViewId = await resolveDataViewId(panel.dataView);
        const panelRefName = `panel_${i}`;
        const objectTitle = `[AI:${plan.stableKey}] ${panel.title}`;
        const id = panel.visualization === "table"
            ? await upsertSearchObject(objectTitle, panel.query, panel.columns ?? ["@timestamp", "Body"], dataViewId)
            : await upsertVisualizationObject(objectTitle, panel.query, panel.visualization, dataViewId, panel.breakdownField);
        const type = panel.visualization === "table" ? "search" : "visualization";
        references.push({ name: panelRefName, type, id });
        const w = panel.layout?.w ?? 24;
        const h = panel.layout?.h ?? 12;
        panels.push({
            version: "8.14.3",
            type,
            panelIndex: String(i + 1),
            panelRefName,
            embeddableConfig: {},
            gridData: {
                x,
                y,
                w,
                h,
                i: String(i + 1)
            }
        });
        x += w;
        if (x >= 48) {
            x = 0;
            y += h;
        }
    }
    return {
        attributes: {
            title: plan.dashboardTitle,
            description: `AI generated draft. Reason: ${plan.reason}`,
            panelsJSON: JSON.stringify(panels),
            optionsJSON: JSON.stringify({ useMargins: true, syncColors: true }),
            version: 1,
            timeRestore: false,
            kibanaSavedObjectMeta: {
                searchSourceJSON: JSON.stringify({
                    query: { language: "kuery", query: "" },
                    filter: []
                })
            }
        },
        references
    };
}
export async function publishDashboardDraft(finding, plan) {
    if (env.AGENT_DRY_RUN) {
        console.log("[dry-run] dashboard plan", JSON.stringify({ finding, plan }, null, 2));
        return;
    }
    if (env.AGENT_REQUIRE_REVIEW || plan.lifecycle.reviewRequired) {
        console.log("[review-required] dashboard plan", JSON.stringify({ finding, plan }, null, 2));
        return;
    }
    const registry = readRegistry();
    const registryKey = plan.dedupe.key || finding.fingerprint;
    const existing = registry[registryKey];
    if (existing) {
        console.log(`Dashboard already mapped for ${registryKey}: ${existing.title} (${env.KIBANA_URL}/app/dashboards#/view/${existing.dashboardId})`);
        return;
    }
    const content = await buildDashboardContent(finding, plan);
    const byTitle = await getSavedObjectByExactTitle("dashboard", plan.dashboardTitle);
    let dashboardId;
    if (byTitle) {
        await kibanaRequest(`/api/saved_objects/dashboard/${byTitle.id}`, {
            method: "PUT",
            body: content
        });
        dashboardId = byTitle.id;
        console.log(`Dashboard updated: ${plan.dashboardTitle}`);
    }
    else {
        const created = await kibanaRequest("/api/saved_objects/dashboard", {
            method: "POST",
            body: content
        });
        dashboardId = created.id;
        console.log(`Dashboard created: ${plan.dashboardTitle}`);
    }
    registry[registryKey] = {
        dashboardId,
        title: plan.dashboardTitle,
        updatedAt: new Date().toISOString()
    };
    writeRegistry(registry);
    console.log(`Open: ${env.KIBANA_URL}/app/dashboards#/view/${dashboardId}`);
}
