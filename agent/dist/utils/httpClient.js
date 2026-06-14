export async function fetchJson(url, options) {
    const response = await fetch(url, {
        method: options.method,
        headers: {
            "content-type": "application/json",
            ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${options.method} ${url} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json());
}
