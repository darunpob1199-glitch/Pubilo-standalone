// FEWFEED Facebook Content Script
// Runs on facebook.com and business.facebook.com to make GraphQL calls with proper cookies
// Also extracts access tokens from page HTML

console.log("[FEWFEED FB] Content script loaded on", window.location.href);
globalThis.__PUBILO_FB_CONTENT_SCRIPT_ACTIVE__ = true;

// Auto-extract token when page loads and send to background
(function autoExtractToken() {
  const html = document.documentElement.outerHTML;

  // Try to find access token
  const tokenPatterns = [
    /__accessToken\s*=\s*"(EA[A-Za-z0-9]+)"/,
    /"__accessToken"\s*:\s*"(EA[A-Za-z0-9]+)"/,
    /__window\.__accessToken="(EA[A-Za-z0-9]+)"/,
    /"accessToken":"(EA[A-Za-z0-9]+)"/,
    /"access_token":"(EA[A-Za-z0-9]+)"/
  ];
  const escapedTokenPatterns = [
    /\\"__accessToken\\"\s*:\s*\\"(EA[A-Za-z0-9]+)\\"/,
    /\\"accessToken\\"\s*:\s*\\"(EA[A-Za-z0-9]+)\\"/,
    /\\"access_token\\"\s*:\s*\\"(EA[A-Za-z0-9]+)\\"/
  ];

  let token = null;
  for (const pattern of tokenPatterns) {
    const match = html.match(pattern);
    if (match) {
      token = match[1];
      console.log("[FEWFEED FB] Found token with pattern:", pattern.toString().substring(0, 30));
      break;
    }
  }

  if (!token) {
    for (const pattern of escapedTokenPatterns) {
      const match = html.match(pattern);
      if (match) {
        token = match[1];
        console.log("[FEWFEED FB] Found token with escaped pattern:", pattern.toString().substring(0, 30));
        break;
      }
    }
  }

  if (!token && typeof window.__accessToken === "string") {
    token = window.__accessToken;
    console.log("[FEWFEED FB] Found token from window.__accessToken");
  }

  // Try to find fb_dtsg
  const dtsgPatterns = [
    /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
    /name="fb_dtsg"\s+value="([^"]+)"/,
    /"fb_dtsg":"([^"]+)"/
  ];

  let dtsg = null;
  for (const pattern of dtsgPatterns) {
    const match = html.match(pattern);
    if (match) {
      dtsg = match[1];
      break;
    }
  }

  if (token || dtsg) {
    // Try to extract profile picture URL
    let avatarUrl = null;
    const avatarImg = document.querySelector('image[*|href*="scontent"]') || 
                      document.querySelector('svg image[href*="scontent"]') ||
                      document.querySelector('img[alt*="profile picture"]');
    if (avatarImg) {
      avatarUrl = avatarImg.getAttribute('xlink:href') || avatarImg.getAttribute('href') || avatarImg.src;
    }

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
    const html = document.documentElement.outerHTML;

    const tokenPatterns = [
      /__accessToken\s*=\s*"(EA[A-Za-z0-9]+)"/,
      /"__accessToken"\s*:\s*"(EA[A-Za-z0-9]+)"/,
      /__window\.__accessToken="(EA[A-Za-z0-9]+)"/,
      /"accessToken":"(EA[A-Za-z0-9]+)"/,
      /"access_token":"(EA[A-Za-z0-9]+)"/
    ];
    const escapedTokenPatterns = [
      /\\"__accessToken\\"\s*:\s*\\"(EA[A-Za-z0-9]+)\\"/,
      /\\"accessToken\\"\s*:\s*\\"(EA[A-Za-z0-9]+)\\"/,
      /\\"access_token\\"\s*:\s*\\"(EA[A-Za-z0-9]+)\\"/
    ];

    let token = null;
    for (const pattern of tokenPatterns) {
      const match = html.match(pattern);
      if (match) {
        token = match[1];
        break;
      }
    }

    if (!token) {
      for (const pattern of escapedTokenPatterns) {
        const match = html.match(pattern);
        if (match) {
          token = match[1];
          break;
        }
      }
    }

    if (!token && typeof window.__accessToken === "string") {
      token = window.__accessToken;
    }

    const dtsgPatterns = [
      /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
      /name="fb_dtsg"\s+value="([^"]+)"/,
      /"fb_dtsg":"([^"]+)"/
    ];

    let dtsg = null;
    for (const pattern of dtsgPatterns) {
      const match = html.match(pattern);
      if (match) {
        dtsg = match[1];
        break;
      }
    }

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
