import { env } from "../config/env.js";

export async function elasticsearchSearch<T>(index: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.ELASTICSEARCH_URL}/${index}/_search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Elasticsearch search failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}
