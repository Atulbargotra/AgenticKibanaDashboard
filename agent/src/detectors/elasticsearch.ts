import { env } from "../config/env.js";
import { fetchJson } from "../utils/httpClient.js";

export async function elasticsearchSearch<T>(index: string, body: unknown): Promise<T> {
  return fetchJson<T>(`${env.ELASTICSEARCH_URL}/${index}/_search`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(`Elasticsearch search failed on ${index}: ${response.status} ${body}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Elasticsearch returned non-JSON for ${index} (${response.status}): ${text.slice(0, 200)}`,
    );
  }
}
