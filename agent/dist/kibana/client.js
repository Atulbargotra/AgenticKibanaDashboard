import { env } from "../config/env.js";
import { fetchJson } from "../utils/httpClient.js";
function spacePath(path) {
    if (env.KIBANA_SPACE === "default") {
        return path;
    }
    return `/s/${env.KIBANA_SPACE}${path}`;
}
export async function kibanaRequest(path, init) {
    return fetchJson(`${env.KIBANA_URL}${spacePath(path)}`, {
        method: init.method,
        headers: { "kbn-xsrf": "agentic-kibana-dashboard" },
        body: init.body,
    });
}
