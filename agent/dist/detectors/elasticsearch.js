import { env } from "../config/env.js";
import { fetchJson } from "../utils/httpClient.js";
export async function elasticsearchSearch(index, body) {
    return fetchJson(`${env.ELASTICSEARCH_URL}/${index}/_search`, {
        method: "POST",
        body,
    });
}
