const FB_API = "https://graph.facebook.com/v21.0";
const MAX_SHARE_OPERATIONS = 100;
const NO_STORE_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate",
  "pragma": "no-cache",
  "expires": "0",
};

function isLocalDevHost(hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(String(hostname || "").toLowerCase());
}

function isCacheSensitiveAssetPath(pathname) {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname.endsWith(".html") ||
    pathname.startsWith("/js/") ||
    pathname.startsWith("/css/") ||
    pathname === "/_worker.js"
  );
}

function withNoStoreHeaders(headers) {
  const nextHeaders = new Headers(headers);
  Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => {
    nextHeaders.set(key, value);
  });
  return nextHeaders;
}

function appendDevCacheBust(rawUrl, devVersion) {
  if (!rawUrl || !devVersion) return rawUrl;
  if (!(rawUrl.startsWith("/js/") || rawUrl.startsWith("/css/"))) return rawUrl;

  try {
    const parsed = new URL(rawUrl, "https://pubilo.local");
    parsed.searchParams.set("dev", devVersion);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const joiner = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${joiner}dev=${encodeURIComponent(devVersion)}`;
  }
}

function rewriteLocalHtmlAssetVersions(html, devVersion) {
  return String(html || "").replace(
    /\b(src|href)=["'](\/(?:js|css)\/[^"']+)["']/g,
    (match, attr, rawUrl) => `${attr}="${appendDevCacheBust(rawUrl, devVersion)}"`,
  );
}

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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePostType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.includes("reel") || normalized.includes("video")) return "reels";
  if (normalized.includes("image") || normalized.includes("photo")) return "image";
  if (normalized.includes("text")) return "text";
  return normalized || "link";
}

function normalizeFacebookPostId(value) {
  return normalizeText(value).replace(/^fb:/i, "");
}

function buildFacebookPostUrl(post, sourcePageId = "") {
  const explicitUrl = normalizeText(post.facebookUrl || post.facebook_url);
  if (explicitUrl) return explicitUrl;

  const postId = normalizeFacebookPostId(post.id);
  if (!postId) return "";

  const parts = postId.split("_").filter(Boolean);
  const objectId = parts.length > 1 ? parts[parts.length - 1] : postId;
  const ownerId = parts.length > 1 ? parts[0] : normalizeText(sourcePageId);
  const postType = normalizePostType(post.postType || post.post_type);

  if (postType === "reels") {
    return `https://www.facebook.com/reel/${encodeURIComponent(objectId)}/`;
  }
  if (ownerId && objectId) {
    return `https://www.facebook.com/${encodeURIComponent(ownerId)}/posts/${encodeURIComponent(objectId)}`;
  }
  return `https://www.facebook.com/${encodeURIComponent(postId)}`;
}

function isHttpUrl(value) {
  const normalized = normalizeText(value);
  return normalized.startsWith("https://") || normalized.startsWith("http://");
}

function buildFacebookHeaders(cookieData) {
  const normalizedCookie = normalizeText(cookieData);
  if (!normalizedCookie) return undefined;
  return {
    Cookie: normalizedCookie,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
}

async function fetchFreshPageToken(pageId, accessToken, cookieData) {
  const normalizedPageId = normalizeText(pageId);
  const normalizedAccessToken = normalizeText(accessToken);
  const headers = buildFacebookHeaders(cookieData);
  if (!normalizedPageId) return "";

  if (normalizedAccessToken) {
    try {
      const accountsRes = await fetch(
        `${FB_API}/me/accounts?access_token=${encodeURIComponent(normalizedAccessToken)}&fields=id,access_token&limit=100`,
        headers ? { headers } : undefined,
      );
      const accountsData = await accountsRes.json();
      const matchedPage = Array.isArray(accountsData?.data)
        ? accountsData.data.find((page) => String(page.id) === normalizedPageId)
        : null;
      if (matchedPage?.access_token) return normalizeText(matchedPage.access_token);
    } catch (_) {
      // Continue to direct page token lookup.
    }

    try {
      const tokenRes = await fetch(
        `${FB_API}/${encodeURIComponent(normalizedPageId)}?fields=access_token&access_token=${encodeURIComponent(normalizedAccessToken)}`,
        headers ? { headers } : undefined,
      );
      const tokenData = await tokenRes.json();
      if (tokenData?.access_token) return normalizeText(tokenData.access_token);
    } catch (_) {
      // Continue to cookie-only lookup.
    }
  }

  if (headers) {
    try {
      const cookieRes = await fetch(
        `${FB_API}/me/accounts?fields=id,access_token&limit=100`,
        { headers },
      );
      const cookiePayload = await cookieRes.json();
      const matchedPage = Array.isArray(cookiePayload?.data)
        ? cookiePayload.data.find((page) => String(page.id) === normalizedPageId)
        : null;
      if (matchedPage?.access_token) return normalizeText(matchedPage.access_token);
    } catch (_) {
      // No usable fallback token.
    }
  }

  return "";
}

function formatFacebookError(data, fallback = "Graph request failed") {
  const code = data?.error?.code ? ` code=${data.error.code}` : "";
  const type = data?.error?.type ? ` type=${data.error.type}` : "";
  const subcode = data?.error?.error_subcode ? ` subcode=${data.error.error_subcode}` : "";
  return String(data?.error?.message || data?.message || fallback) + code + type + subcode;
}

async function sharePostToPage(post, sourcePageId, targetPageId, targetPageToken) {
  const link = buildFacebookPostUrl(post, sourcePageId);
  if (!link) {
    throw new Error("Missing source post link");
  }

  const response = await fetch(`${FB_API}/${encodeURIComponent(targetPageId)}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      link,
      access_token: targetPageToken,
    }).toString(),
  });
  const data = await response.json();

  if (response.ok && data?.id) {
    return String(data.id);
  }

  throw new Error(formatFacebookError(data, "Graph share failed"));
}

async function copyPostToPage(post, sourcePageId, targetPageId, targetPageToken) {
  const postType = normalizePostType(post.postType || post.post_type);
  const mediaUrl = normalizeText(post.mediaUrl || post.media_url || post.mediaThumbUrl || post.media_thumb_url);
  const messageText = normalizeText(post.messageText || post.message_text);
  const sourceUrl = buildFacebookPostUrl(post, sourcePageId);
  let photoCopyError = "";

  if (postType === "image" && isHttpUrl(mediaUrl)) {
    const response = await fetch(`${FB_API}/${encodeURIComponent(targetPageId)}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        url: mediaUrl,
        caption: messageText,
        access_token: targetPageToken,
      }).toString(),
    });
    const data = await response.json();
    if (response.ok && (data?.post_id || data?.id)) {
      return String(data.post_id || data.id);
    }
    photoCopyError = formatFacebookError(data, "Graph photo copy failed");
  }

  const messageParts = [messageText];
  if (postType !== "text" || !messageText) {
    messageParts.push(sourceUrl);
  }
  const message = messageParts.map((part) => normalizeText(part)).filter(Boolean).join("\n\n");
  if (!message) {
    throw new Error("Missing message or source link for copy fallback");
  }

  const response = await fetch(`${FB_API}/${encodeURIComponent(targetPageId)}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      message,
      access_token: targetPageToken,
    }).toString(),
  });
  const data = await response.json();
  if (response.ok && data?.id) {
    return String(data.id);
  }
  const postCopyError = formatFacebookError(data, "Graph post copy failed");
  throw new Error(photoCopyError ? `${photoCopyError}; text fallback failed: ${postCopyError}` : postCopyError);
}

async function shareOrCopyPostToPage(post, sourcePageId, targetPageId, targetPageToken) {
  try {
    return {
      id: await sharePostToPage(post, sourcePageId, targetPageId, targetPageToken),
      method: "native_share",
    };
  } catch (shareError) {
    const shareMessage = shareError instanceof Error ? shareError.message : String(shareError);
    try {
      return {
        id: await copyPostToPage(post, sourcePageId, targetPageId, targetPageToken),
        method: "copy_post",
        warningMessage: `Native share failed, copied post instead: ${shareMessage}`,
      };
    } catch (copyError) {
      const copyMessage = copyError instanceof Error ? copyError.message : String(copyError);
      throw new Error(`Native share failed: ${shareMessage}; copy fallback failed: ${copyMessage}`);
    }
  }
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

async function handleSharePosts(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const sourcePageId = normalizeText(body.sourcePageId || body.pageId);
    const posts = Array.isArray(body.posts)
      ? body.posts
        .map((post) => ({
          id: normalizeText(post.id),
          messageText: normalizeText(post.messageText || post.message_text),
          postType: normalizePostType(post.postType || post.post_type),
          publishedAt: normalizeText(post.publishedAt || post.published_at),
          facebookUrl: normalizeText(post.facebookUrl || post.facebook_url),
          mediaUrl: normalizeText(post.mediaUrl || post.media_url),
          mediaThumbUrl: normalizeText(post.mediaThumbUrl || post.media_thumb_url),
        }))
        .filter((post) => post.id)
      : [];
    const targets = Array.isArray(body.targetPages)
      ? body.targetPages
        .map((target) => ({
          id: normalizeText(target.id || target.pageId),
          name: normalizeText(target.name || target.pageName),
        }))
        .filter((target) => target.id && target.id !== sourcePageId)
      : [];
    const targetPageTokens = body.targetPageTokens && typeof body.targetPageTokens === "object"
      ? body.targetPageTokens
      : {};
    const accessToken = normalizeText(body.accessToken);
    const cookieData = normalizeText(body.cookieData);

    if (!sourcePageId) {
      return jsonResponse({ success: false, error: "Missing sourcePageId" }, { status: 400 });
    }
    if (!posts.length) {
      return jsonResponse({ success: false, error: "Please select at least one post" }, { status: 400 });
    }
    if (!targets.length) {
      return jsonResponse({ success: false, error: "Please select at least one target page" }, { status: 400 });
    }

    const operationCount = posts.length * targets.length;
    if (operationCount > MAX_SHARE_OPERATIONS) {
      return jsonResponse({
        success: false,
        error: `แชร์ต่อรอบได้สูงสุด ${MAX_SHARE_OPERATIONS} รายการ ตอนนี้มี ${operationCount} รายการ`,
      }, { status: 400 });
    }

    const tokenByTarget = new Map();
    for (const target of targets) {
      const providedToken = normalizeText(targetPageTokens[target.id]);
      const freshToken = providedToken || await fetchFreshPageToken(target.id, accessToken, cookieData);
      tokenByTarget.set(target.id, freshToken);
    }

    const results = [];
    for (const post of posts) {
      for (const target of targets) {
        const token = tokenByTarget.get(target.id) || "";
        if (!token) {
          results.push({
            postId: post.id,
            targetPageId: target.id,
            targetPageName: target.name,
            status: "failed",
            error: "Missing Page Token for target page",
          });
          continue;
        }

        try {
          const shareResult = await shareOrCopyPostToPage(post, sourcePageId, target.id, token);
          results.push({
            postId: post.id,
            targetPageId: target.id,
            targetPageName: target.name,
            status: "shared",
            method: shareResult.method,
            warning: shareResult.warningMessage,
            sharedPostId: shareResult.id,
            facebookUrl: `https://www.facebook.com/${shareResult.id}`,
          });
        } catch (error) {
          results.push({
            postId: post.id,
            targetPageId: target.id,
            targetPageName: target.name,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const successCount = results.filter((result) => result.status === "shared").length;
    return jsonResponse({
      success: true,
      source: "web-worker-share",
      sourcePageId,
      total: results.length,
      successCount,
      failedCount: results.length - successCount,
      results,
    });
  } catch (error) {
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
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

    if (url.pathname === "/api/share-posts") {
      return handleSharePosts(request);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("content-type") || "";
    const shouldRewriteForDev = isLocalDevHost(url.hostname) && contentType.includes("text/html");
    const shouldForceNoStore =
      isLocalDevHost(url.hostname) ||
      isCacheSensitiveAssetPath(url.pathname) ||
      contentType.includes("text/html") ||
      contentType.includes("javascript") ||
      contentType.includes("text/css");

    if (shouldRewriteForDev) {
      const html = await assetResponse.text();
      const devVersion = String(Date.now());
      return new Response(rewriteLocalHtmlAssetVersions(html, devVersion), {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: withNoStoreHeaders(assetResponse.headers),
      });
    }

    if (shouldForceNoStore) {
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: withNoStoreHeaders(assetResponse.headers),
      });
    }

    return assetResponse;
  },
};
