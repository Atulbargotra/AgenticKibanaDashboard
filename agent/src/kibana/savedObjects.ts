import { kibanaRequest } from "./client.js";

type SavedObjectFindResponse = {
  saved_objects: Array<{ id: string; attributes?: { title?: string } }>;
};

const INDEX_REF_NAME = "kibanaSavedObjectMeta.searchSourceJSON.index";

export async function getSavedObjectByExactTitle(
  type: string,
  title: string,
): Promise<{ id: string } | null> {
  const result = await kibanaRequest<SavedObjectFindResponse>(
    `/api/saved_objects/_find?type=${encodeURIComponent(type)}&search_fields=title&search=${encodeURIComponent(title)}&per_page=100`,
    { method: "GET" },
  );
  const exact = result.saved_objects.find(
    (obj) => obj.attributes?.title === title,
  );
  return exact ? { id: exact.id } : null;
}

export async function upsertSavedObject(
  type: string,
  title: string,
  body: unknown,
): Promise<{ id: string; created: boolean }> {
  const existing = await getSavedObjectByExactTitle(type, title);
  if (existing) {
    await kibanaRequest(`/api/saved_objects/${type}/${existing.id}`, {
      method: "PUT",
      body,
    });
    return { id: existing.id, created: false };
  }
  const response = await kibanaRequest<{ id: string }>(
    `/api/saved_objects/${type}`,
    { method: "POST", body },
  );
  return { id: response.id, created: true };
}

export function buildSearchSource(
  query: string,
  indexRefName?: string,
): string {
  const source: Record<string, unknown> = {
    query: { language: "kuery", query },
    filter: [],
  };
  if (indexRefName) {
    source.indexRefName = indexRefName;
  }
  return JSON.stringify(source);
}

export function buildDataViewReference(
  dataViewId: string,
): { name: string; type: string; id: string } {
  return { name: INDEX_REF_NAME, type: "index-pattern", id: dataViewId };
}
