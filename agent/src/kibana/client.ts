import { env } from "../config/env.js";

type KibanaMethod = "GET" | "POST" | "PUT" | "DELETE";

export function spacePath(path: string): string {
  if (env.KIBANA_SPACE === "default") {
    return path;
  }
  return `/s/${env.KIBANA_SPACE}${path}`;
}

export async function kibanaRequest<T>(path: string, init: { method: KibanaMethod; body?: unknown }): Promise<T> {
  const response = await fetch(`${env.KIBANA_URL}${spacePath(path)}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      "kbn-xsrf": "agentic-kibana-dashboard"
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
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
