function resolveApiOrigin(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1") {
    return "http://127.0.0.1:8787";
  }
  if (
    normalized === "pubilo-web-dev.pages.dev" ||
    normalized.endsWith(".pubilo-web-dev.pages.dev")
  ) {
    return "https://pubilo-api-dev.lungnuek.workers.dev";
  }
  return "https://api.pubilo.com";
}

async function handleNewsLink(request) {
  const requestUrl = new URL(request.url);
  const apiOrigin = resolveApiOrigin(requestUrl.hostname);
  const upstreamUrl = new URL("/api/news-link", apiOrigin);
  upstreamUrl.search = requestUrl.search;

  const upstreamResponse = await fetch(upstreamUrl.toString(), {
    method: "GET",
    headers: {
      "user-agent": request.headers.get("user-agent") || "",
      "x-public-preview-url": requestUrl.toString(),
    },
  });

  const headers = new Headers(upstreamResponse.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate");
  headers.delete("content-length");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/news-link") {
      return handleNewsLink(request);
    }

    return env.ASSETS.fetch(request);
  },
};
