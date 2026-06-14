import { kibanaRequest } from "./client.js";
const INDEX_REF_NAME = "kibanaSavedObjectMeta.searchSourceJSON.index";
export async function getSavedObjectByExactTitle(type, title) {
    const result = await kibanaRequest(`/api/saved_objects/_find?type=${encodeURIComponent(type)}&search_fields=title&search=${encodeURIComponent(title)}&per_page=100`, { method: "GET" });
    const exact = result.saved_objects.find((obj) => obj.attributes?.title === title);
    return exact ? { id: exact.id } : null;
}
export async function upsertSavedObject(type, title, body) {
    const existing = await getSavedObjectByExactTitle(type, title);
    if (existing) {
        await kibanaRequest(`/api/saved_objects/${type}/${existing.id}`, {
            method: "PUT",
            body,
        });
        return { id: existing.id, created: false };
    }
    const response = await kibanaRequest(`/api/saved_objects/${type}`, { method: "POST", body });
    return { id: response.id, created: true };
}
export function buildSearchSource(query, indexRefName) {
    const source = {
        query: { language: "kuery", query },
        filter: [],
    };
    if (indexRefName) {
        source.indexRefName = indexRefName;
    }
    return JSON.stringify(source);
}
export function buildDataViewReference(dataViewId) {
    return { name: INDEX_REF_NAME, type: "index-pattern", id: dataViewId };
}
