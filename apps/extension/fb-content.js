// FEWFEED Facebook Content Script
// Runs on facebook.com and business.facebook.com to make GraphQL calls with proper cookies
// Also extracts access tokens from page HTML

console.log("[FEWFEED FB] Content script loaded on", window.location.href);
globalThis.__PUBILO_FB_CONTENT_SCRIPT_ACTIVE__ = true;

function collectAccessTokenCandidatesFromText(text) {
  const source = String(text || "");
  if (!source) return [];

  const candidates = [];
  const TOKEN_CHARS = "[A-Za-z0-9_-]+";
  const explicitPatterns = [
    new RegExp(`__accessToken\\s*=\\s*"(EA${TOKEN_CHARS})"`, "g"),
    new RegExp(`"__accessToken"\\s*:\\s*"(EA${TOKEN_CHARS})"`, "g"),
    new RegExp(`__window\\.__accessToken="(EA${TOKEN_CHARS})"`, "g"),
    new RegExp(`"accessToken":"(EA${TOKEN_CHARS})"`, "g"),
    new RegExp(`"access_token":"(EA${TOKEN_CHARS})"`, "g"),
    new RegExp(`\\\\"__accessToken\\\\"\\s*:\\s*\\\\"(EA${TOKEN_CHARS})\\\\"`, "g"),
    new RegExp(`\\\\"accessToken\\\\"\\s*:\\s*\\\\"(EA${TOKEN_CHARS})\\\\"`, "g"),
    new RegExp(`\\\\"access_token\\\\"\\s*:\\s*\\\\"(EA${TOKEN_CHARS})\\\\"`, "g"),
  ];
  for (const pattern of explicitPatterns) {
    const matches = source.matchAll(pattern);
    for (const match of matches) {
      if (match?.[1]) candidates.push(String(match[1]).trim());
    }
  }

  const looseMatches = source.match(/EA[A-Za-z0-9_-]{20,}/g) || [];
  for (const token of looseMatches) {
    candidates.push(String(token || "").trim());
  }

  return candidates;
}

function pickBestAccessToken(tokens) {
  const unique = Array.from(
    new Set((tokens || []).map((token) => String(token || "").trim()).filter(Boolean)),
  );
  const score = (token) => {
    if (token.startsWith("EAABsbCS")) return 400 + token.length;
    if (token.startsWith("EAAChZC")) return 300 + token.length;
    if (token.startsWith("EAAG")) return 200 + token.length;
    return 100 + token.length;
  };
  unique.sort((a, b) => score(b) - score(a));
  return unique[0] || "";
}

function extractTokenAndDtsgFromPage() {
  const html = document.documentElement?.outerHTML || "";
  const scriptText = Array.from(document.scripts || [])
    .map((script) => script?.textContent || "")
    .join("\n");

  let storageBlob = "";
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const value = key ? localStorage.getItem(key) : "";
      if (value) storageBlob += `\n${value}`;
    }
  } catch (_) {}

  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      const value = key ? sessionStorage.getItem(key) : "";
      if (value) storageBlob += `\n${value}`;
    }
  } catch (_) {}

  const tokenCandidates = [
    ...collectAccessTokenCandidatesFromText(html),
    ...collectAccessTokenCandidatesFromText(scriptText),
    ...collectAccessTokenCandidatesFromText(storageBlob),
  ];

  if (typeof window.__accessToken === "string" && window.__accessToken.trim()) {
    tokenCandidates.push(window.__accessToken.trim());
  }

  const token = pickBestAccessToken(tokenCandidates);

  const dtsgPatterns = [
    /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
    /name="fb_dtsg"\s+value="([^"]+)"/,
    /"fb_dtsg":"([^"]+)"/,
    /fb_dtsg['"]\s*:\s*['"]([\w:_-]+)['"]/,
  ];
  let dtsg = "";
  for (const pattern of dtsgPatterns) {
    const fromHtml = html.match(pattern);
    if (fromHtml?.[1]) {
      dtsg = String(fromHtml[1]).trim();
      break;
    }
    const fromScript = scriptText.match(pattern);
    if (fromScript?.[1]) {
      dtsg = String(fromScript[1]).trim();
      break;
    }
  }

  // Try to extract profile picture URL
  let avatarUrl = "";
  const avatarImg = document.querySelector('image[*|href*="scontent"]') ||
    document.querySelector('svg image[href*="scontent"]') ||
    document.querySelector('img[alt*="profile picture"]') ||
    document.querySelector('img[alt*="รูปโปรไฟล์"]') ||
    document.querySelector('img[src*="scontent"]');
  if (avatarImg) {
    avatarUrl = avatarImg.getAttribute("xlink:href") || avatarImg.getAttribute("href") || avatarImg.src || "";
  }

  return { token, dtsg, avatarUrl };
}

// Auto-extract token when page loads and send to background
(function autoExtractToken() {
  const { token, dtsg, avatarUrl } = extractTokenAndDtsgFromPage();
  if (token || dtsg) {
    console.log("[FEWFEED FB] Auto-extracted:", { hasToken: !!token, hasDtsg: !!dtsg, hasAvatar: !!avatarUrl });
    chrome.runtime.sendMessage({
      action: "tokenExtracted",
      token: token,
      dtsg: dtsg,
      avatarUrl: avatarUrl,
      source: window.location.hostname
    });
  }
})();

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle token extraction request
  if (request.action === "extractToken") {
    const { token, dtsg } = extractTokenAndDtsgFromPage();
    console.log("[FEWFEED FB] Token extraction:", { hasToken: !!token, hasDtsg: !!dtsg });
    sendResponse({ token, dtsg });
    return;
  }

  if (request.action === "schedulePostGraphQL") {
    console.log("[FEWFEED FB] Received schedule request:", request);

    schedulePost(request.storyId, request.pageId, request.fbDtsg, request.scheduledTime)
      .then(result => {
        console.log("[FEWFEED FB] Schedule result:", result);
        sendResponse(result);
      })
      .catch(error => {
        console.error("[FEWFEED FB] Schedule error:", error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep channel open for async response
  }
});

async function schedulePost(storyId, pageId, fbDtsg, scheduledTime) {
  // doc_id from business.facebook.com for BusinessToolsContentManagementPublishingActionMutation
  const docId = "24110679831861040";

  const variables = JSON.stringify({
    input: {
      client_mutation_id: "1",
      actor_id: pageId,
      story_ids: [storyId],
      page_id: pageId,
      scheduled_publish_time: scheduledTime,
    },
  });

  const formData = new FormData();
  formData.append("fb_dtsg", fbDtsg);
  formData.append("av", pageId);
  formData.append("server_timestamps", "true");
  formData.append("doc_id", docId);
  formData.append("variables", variables);

  console.log("[FEWFEED FB] Making GraphQL request...");

  const response = await fetch("https://business.facebook.com/api/graphql/", {
    method: "POST",
    body: formData,
    credentials: "include"
  });

  const text = await response.text();
  console.log("[FEWFEED FB] GraphQL response:", text.substring(0, 300));

  if (!text || text.length === 0) {
    return { success: false, error: "Empty response from GraphQL" };
  }

  const data = JSON.parse(text);

  if (data.errors || data.error) {
    const errorMsg = data.errors?.[0]?.message || data.error?.message || "Unknown error";
    return { success: false, error: errorMsg };
  }

  if (data.data?.publishing_action?.error === null) {
    return { success: true };
  }

  if (data.data?.publishing_action?.error) {
    return { success: false, error: data.data.publishing_action.error };
  }

  return { success: false, error: "Unexpected response" };
}

// Signal that we're ready
console.log("[FEWFEED FB] Ready to handle GraphQL requests");
