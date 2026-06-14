import { env } from "../config/env.js";
import { fetchJson } from "../utils/httpClient.js";

export async function elasticsearchSearch<T>(index: string, body: unknown): Promise<T> {
  return fetchJson<T>(`${env.ELASTICSEARCH_URL}/${index}/_search`, {
    method: "POST",
    body,
  });
}
