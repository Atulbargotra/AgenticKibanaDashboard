import { env } from "../config/env.js";
import { fetchJson } from "../utils/httpClient.js";

type KibanaMethod = "GET" | "POST" | "PUT" | "DELETE";

export function spacePath(path: string): string {
  if (env.KIBANA_SPACE === "default") {
    return path;
  }
  return `/s/${env.KIBANA_SPACE}${path}`;
}

export async function kibanaRequest<T>(path: string, init: { method: KibanaMethod; body?: unknown }): Promise<T> {
  return fetchJson<T>(`${env.KIBANA_URL}${spacePath(path)}`, {
    method: init.method,
    headers: { "kbn-xsrf": "agentic-kibana-dashboard" },
    body: init.body,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(`Kibana API failed: ${init.method} ${path} → ${response.status} ${body}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Kibana API returned non-JSON for ${init.method} ${path} (${response.status}): ${text.slice(0, 200)}`,
    );
  }
}
