// Pubilo Token Helper v9.0
// Auto-fetches Ads Token + Cookie from Facebook
// Post Token is now managed manually via Page Settings (not from Extension)

// ============================================
// HOT RELOAD FOR DEVELOPMENT (disabled in production)
// ============================================
(function setupHotReload() {
  // Only enable hot reload if explicitly enabled via localStorage or in dev mode
  // Set localStorage.setItem('PUBILO_DEV_MODE', 'true') to enable
  const DEV_MODE = false; // Set to true during development
  if (!DEV_MODE) return;

  const WS_URL = "ws://localhost:35729";
  let ws = null;
  let reconnectTimer = null;
  let connectionFailed = false;

  function connect() {
    if (connectionFailed) return; // Don't retry after first failure

    try {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[HotReload] Connected to dev server");
        connectionFailed = false;
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "reload") {
            console.log(`[HotReload] Reloading... (${data.file} changed)`);
            chrome.runtime.reload();
          }
        } catch (e) {
          // Ignore parse errors (like pong responses)
        }
      };

      ws.onclose = () => {
        ws = null;
        // Only reconnect if we were previously connected
        if (!connectionFailed && !reconnectTimer) {
          reconnectTimer = setInterval(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = () => {
        // Mark as failed so we don't keep retrying
        connectionFailed = true;
        if (reconnectTimer) {
          clearInterval(reconnectTimer);
          reconnectTimer = null;
        }
        ws?.close();
      };
    } catch (e) {
      connectionFailed = true;
    }
  }

  // Start connection
  connect();

  // Send keepalive ping every 30 seconds
  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send("ping");
    }
  }, 30000);
})();

// ============================================
// MAIN EXTENSION CODE
// ============================================

// ============================================
// KEEPALIVE - Keep service worker alive
// ============================================
const KEEPALIVE_INTERVAL = 20; // seconds (must be under 30s for Chrome)

// Create keepalive alarm on startup
chrome.alarms.create("keepalive", { periodInMinutes: 0.4 }); // ~24 seconds

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") {
    // Just log to keep service worker active
    console.log("[Pubilo] Keepalive ping", new Date().toLocaleTimeString());
    injectScriptsIntoExistingTabs().catch(() => { });
  }
});

// Also run on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  console.log("[Pubilo] Keepalive alarm created");
  injectScriptsIntoExistingTabs().catch(() => { });
});

chrome.runtime.onStartup.addListener(() => {
  injectScriptsIntoExistingTabs().catch(() => { });
});

// On every service-worker start (including extension reload), try to re-inject
// scripts into already-open tabs so stale invalidated content scripts recover
// without requiring a manual page refresh.
setTimeout(() => {
  injectScriptsIntoExistingTabs().catch((error) => {
    console.warn("[Pubilo] Initial tab script injection failed:", error?.message || error);
  });
}, 250);

// App URLs - supports both local dev and production
const APP_URLS = [
  "http://localhost:3000/*",
  "http://localhost:3005/*",
  "https://pubilo.com/*",
  "https://www.pubilo.com/*",
  "https://pubilo-web-dev.pages.dev/*",
  "https://*.pubilo-web-dev.pages.dev/*",
  "https://pubilo-web-prod.pages.dev/*",
  "https://*.pubilo-web-prod.pages.dev/*"
];
const PRODUCTION_URL = "https://pubilo.com/";
const FB_TAB_URLS = [
  "https://facebook.com/*",
  "https://www.facebook.com/*",
  "https://business.facebook.com/*",
  "https://adsmanager.facebook.com/*"
];
const PAGE_TOKEN_MAP_KEY = "fewfeed_pageTokenMap";
const PAGE_TOKEN_MAP_OWNER_KEY = "fewfeed_pageTokenMapOwnerId";
const ACCESS_TOKEN_VALIDATED_AT_KEY = "fewfeed_accessTokenValidatedAt";
const ACCESS_TOKEN_VALIDATION_STATUS_KEY = "fewfeed_accessTokenValidationStatus";
const ACCESS_TOKEN_REVALIDATE_INTERVAL_MS = 2 * 60 * 1000;
let autoRefreshInFlight = null;

function parseStoredPageTokenMap(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function scheduleAutoSessionRefresh(reason = "auto_refresh") {
  if (autoRefreshInFlight) return;
  autoRefreshInFlight = (async () => {
    try {
      await fetchAndStoreToken();
      await notifyAppTabsSessionUpdated(reason);
    } catch (error) {
      console.warn("[FEWFEED] Auto session refresh failed:", error?.message || error);
    } finally {
      autoRefreshInFlight = null;
    }
  })();
}

async function notifyAppTabsSessionUpdated(reason = "session_updated") {
  const tabs = await listUniqueTabsByPatterns(APP_URLS);
  await Promise.allSettled(
    tabs
      .filter((tab) => !!tab?.id)
      .map((tab) =>
        chrome.tabs.sendMessage(tab.id, {
          action: "tokenUpdated",
          reason,
        }),
      ),
  );
}

let facebookSessionRefreshTimer = null;

function scheduleFacebookSessionRefresh(reason = "cookie_change") {
  if (facebookSessionRefreshTimer) {
    clearTimeout(facebookSessionRefreshTimer);
  }

  facebookSessionRefreshTimer = setTimeout(async () => {
    facebookSessionRefreshTimer = null;
    try {
      await fetchAndStoreToken();
      await notifyAppTabsSessionUpdated(reason);
      injectScriptsIntoExistingTabs().catch(() => {});
      console.log("[FEWFEED] Refreshed Facebook session after cookie change:", reason);
    } catch (error) {
      console.warn("[FEWFEED] Failed to refresh Facebook session after cookie change:", error?.message || error);
    }
  }, 600);
}

function isMissingHostPermissionError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("host permission") ||
    message.includes("no host permissions") ||
    message.includes("missing host permission") ||
    message.includes("cannot access contents of url") ||
    message.includes("permission denied")
  );
}

function isLikelyFacebookAccessToken(token) {
  const normalized = String(token || "").trim();
  return /^EA[A-Za-z0-9_-]+$/.test(normalized) && normalized.length >= 20;
}

function scoreAccessTokenCandidate(token) {
  const normalized = String(token || "").trim();
  if (!isLikelyFacebookAccessToken(normalized)) return -1;
  if (normalized.startsWith("EAABsbCS")) return 500 + normalized.length;
  if (normalized.startsWith("EAAG")) return 450 + normalized.length;
  if (normalized.startsWith("EAAChZC")) return 400 + normalized.length;
  return 300 + normalized.length;
}

function rankAccessTokenCandidates(tokens = []) {
  const unique = Array.from(
    new Set((tokens || []).map((token) => String(token || "").trim()).filter(Boolean)),
  );
  unique.sort((a, b) => scoreAccessTokenCandidate(b) - scoreAccessTokenCandidate(a));
  return unique.filter((token) => scoreAccessTokenCandidate(token) >= 0);
}

async function executeTokenProbeInTab(tabId, world = "MAIN") {
  const runProbe = async (mode) =>
    chrome.scripting.executeScript({
      target: { tabId },
      world: mode,
      injectImmediately: true,
      func: () => {
        const TOKEN_REGEX = /EA[A-Za-z0-9_-]{20,}/g;
        const DYNAMIC_KEY_MATCHER = /(token|access|auth|session|dtsg|actor|user)/i;
        const MAX_ENTRIES_PER_OBJECT = 180;
        const MAX_WINDOW_KEYS = 500;

        const candidates = [];
        const pushCandidate = (value) => {
          const normalized = String(value || "").trim();
          if (!/^EA[A-Za-z0-9_-]{20,}$/.test(normalized)) return;
          candidates.push(normalized);
        };

        const collectFromText = (text) => {
          const source = String(text || "");
          if (!source) return;
          const matches = source.match(TOKEN_REGEX) || [];
          for (const token of matches) pushCandidate(token);
        };

        const seen = new WeakSet();
        const scanObject = (value, depth = 0) => {
          if (depth > 3 || value == null) return;
          if (typeof value === "string") {
            collectFromText(value);
            return;
          }
          if (typeof value !== "object" && typeof value !== "function") return;
          if (typeof value === "object") {
            if (seen.has(value)) return;
            seen.add(value);
          }

          const entries = [];
          try {
            if (Array.isArray(value)) {
              value.slice(0, MAX_ENTRIES_PER_OBJECT).forEach((item, index) => {
                entries.push([String(index), item]);
              });
            } else {
              Object.keys(value)
                .slice(0, MAX_ENTRIES_PER_OBJECT)
                .forEach((key) => {
                  entries.push([key, value[key]]);
                });
            }
          } catch (_) {
            return;
          }

          for (const [key, nestedValue] of entries) {
            if (typeof nestedValue === "string") {
              if (DYNAMIC_KEY_MATCHER.test(String(key)) || /^EA/.test(nestedValue)) {
                collectFromText(nestedValue);
              }
              continue;
            }
            if (DYNAMIC_KEY_MATCHER.test(String(key))) {
              scanObject(nestedValue, depth + 1);
              continue;
            }
            if (depth <= 1 && (typeof nestedValue === "object" || typeof nestedValue === "function")) {
              scanObject(nestedValue, depth + 1);
            }
          }
        };

        try {
          if (typeof window.__accessToken === "string") {
            pushCandidate(window.__accessToken);
          }
        } catch (_) {}

        // Inspect script text + full HTML
        try {
          collectFromText(document.documentElement?.outerHTML || "");
          const scriptText = Array.from(document.scripts || [])
            .map((script) => script?.textContent || "")
            .join("\n");
          collectFromText(scriptText);
        } catch (_) {}

        // Inspect local/session storage
        try {
          for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            const value = key ? localStorage.getItem(key) : "";
            if (value && DYNAMIC_KEY_MATCHER.test(String(key))) {
              collectFromText(value);
            }
          }
        } catch (_) {}
        try {
          for (let i = 0; i < sessionStorage.length; i += 1) {
            const key = sessionStorage.key(i);
            const value = key ? sessionStorage.getItem(key) : "";
            if (value && DYNAMIC_KEY_MATCHER.test(String(key))) {
              collectFromText(value);
            }
          }
        } catch (_) {}

        // Probe known FB modules from MAIN world.
        try {
          if (typeof window.require === "function") {
            const modules = [
              "SiteData",
              "CurrentUserInitialData",
              "DTSGInitialData",
              "LSD",
              "RelayAPIConfigDefaults",
              "MarauderConfig",
            ];
            modules.forEach((moduleName) => {
              try {
                const mod = window.require(moduleName);
                scanObject(mod, 0);
              } catch (_) {}
            });
          }
        } catch (_) {}

        // Shallow scan of window keys for token-bearing globals.
        try {
          Object.keys(window)
            .slice(0, MAX_WINDOW_KEYS)
            .forEach((key) => {
              if (!DYNAMIC_KEY_MATCHER.test(String(key))) return;
              try {
                scanObject(window[key], 0);
              } catch (_) {}
            });
        } catch (_) {}

        const unique = Array.from(new Set(candidates));
        unique.sort((a, b) => {
          const score = (value) => {
            if (value.startsWith("EAABsbCS")) return 500 + value.length;
            if (value.startsWith("EAAG")) return 450 + value.length;
            if (value.startsWith("EAAChZC")) return 400 + value.length;
            return 300 + value.length;
          };
          return score(b) - score(a);
        });

        const dtsgCandidates = [];
        const pushDtsg = (value) => {
          const normalized = String(value || "").trim();
          if (!normalized) return;
          dtsgCandidates.push(normalized);
        };
        try {
          const html = document.documentElement?.outerHTML || "";
          const dtsgPatterns = [
            /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
            /name="fb_dtsg"\s+value="([^"]+)"/,
            /"fb_dtsg":"([^"]+)"/,
            /fb_dtsg['"]\s*:\s*['"]([\w:_-]+)['"]/,
          ];
          dtsgPatterns.forEach((pattern) => {
            const match = html.match(pattern);
            if (match?.[1]) pushDtsg(match[1]);
          });
        } catch (_) {}
        try {
          if (typeof window.require === "function") {
            const dtsgMod = window.require("DTSGInitialData");
            if (dtsgMod?.token) pushDtsg(dtsgMod.token);
          }
        } catch (_) {}

        return {
          token: unique[0] || "",
          candidates: unique,
          dtsg: Array.from(new Set(dtsgCandidates))[0] || "",
          sourceUrl: window.location.href,
        };
      },
    });

  try {
    const result = await runProbe(world);
    return result?.[0]?.result || null;
  } catch (error) {
    if (world !== "ISOLATED") {
      try {
        const fallback = await runProbe("ISOLATED");
        return fallback?.[0]?.result || null;
      } catch (_) {
        // Ignore secondary fallback failures and rethrow primary error below.
      }
    }
    throw error;
  }
}

function isTokenDefinitelyInvalidGraphError(errorObj) {
  const code = Number(errorObj?.code || 0);
  const subcode = Number(errorObj?.error_subcode || 0);
  if (code === 190) return true;
  // Common subcodes for expired/invalid/revoked sessions.
  return [460, 463, 467, 493].includes(subcode);
}

async function validateGraphAccessToken(accessToken, expectedUserId = "", cookieString = "") {
  const normalizedToken = String(accessToken || "").trim();
  const normalizedExpectedUserId = String(expectedUserId || "").trim();
  if (!isLikelyFacebookAccessToken(normalizedToken)) {
    return { ok: false, reason: "token_format_invalid" };
  }

  const requestInit = cookieString
    ? {
      headers: {
        Cookie: cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    }
    : undefined;

  let hadNetworkError = false;
  let lastNonFatalGraphError = null;
  let graphId = "";

  const attemptEndpoints = [
    `https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(normalizedToken)}`,
    `https://graph.facebook.com/v21.0/me/accounts?fields=id&limit=1&access_token=${encodeURIComponent(normalizedToken)}`,
  ];

  for (const endpoint of attemptEndpoints) {
    try {
      const validateResp = await fetch(endpoint, requestInit);
      const validateData = await validateResp.json();

      if (validateData?.id) {
        graphId = String(validateData.id || "").trim();
        const idMismatch = !!(normalizedExpectedUserId && graphId && graphId !== normalizedExpectedUserId);
        if (idMismatch) {
          return {
            ok: true,
            reason: "token_user_mismatch",
            graphId,
            expectedUserId: normalizedExpectedUserId,
            userMismatch: true,
          };
        }
        return { ok: true, graphId, reason: "valid" };
      }

      if (Array.isArray(validateData?.data)) {
        // /me/accounts returned structured data => token is accepted by Graph.
        return {
          ok: true,
          graphId,
          reason: "valid_accounts_endpoint",
        };
      }

      const graphError = validateData?.error || null;
      if (graphError) {
        if (isTokenDefinitelyInvalidGraphError(graphError)) {
          return {
            ok: false,
            reason: "token_invalid",
            graphId,
            expectedUserId: normalizedExpectedUserId,
            error: graphError?.message || "graph_token_invalid",
            code: graphError?.code || null,
            subcode: graphError?.error_subcode || null,
          };
        }

        // Non-190 Graph errors can still happen with valid tokens (permission/app context).
        lastNonFatalGraphError = graphError;
        continue;
      }
    } catch (error) {
      hadNetworkError = true;
      lastNonFatalGraphError = { message: error?.message || String(error) };
    }
  }

  if (lastNonFatalGraphError) {
    // Be permissive here: unknown/non-190 Graph failures should not wipe token and break the app.
    return {
      ok: true,
      graphId,
      reason: "validation_non_fatal_error",
      warning: lastNonFatalGraphError?.message || "non_fatal_graph_error",
    };
  }

  if (hadNetworkError) {
    return {
      ok: false,
      reason: "network_error",
      error: "graph_validation_network_error",
    };
  }

  try {
    // Last chance fallback to unversioned /me.
    const fallbackResp = await fetch(
      `https://graph.facebook.com/me?fields=id&access_token=${encodeURIComponent(normalizedToken)}`,
      requestInit,
    );
    const fallbackData = await fallbackResp.json();
    if (fallbackData?.id) {
      return {
        ok: true,
        graphId: String(fallbackData.id || "").trim(),
        reason: "valid_unversioned",
      };
    }
    const fallbackError = fallbackData?.error || null;
    if (isTokenDefinitelyInvalidGraphError(fallbackError)) {
      return {
        ok: false,
        reason: "token_invalid",
        error: fallbackError?.message || "graph_token_invalid",
        code: fallbackError?.code || null,
        subcode: fallbackError?.error_subcode || null,
      };
    }
    return {
      ok: true,
      reason: "validation_fallback_non_fatal",
      warning: fallbackError?.message || "fallback_non_fatal",
    };
  } catch (_) {
    return {
      ok: false,
      reason: "network_error",
      error: "graph_validation_network_error",
    };
  }
}

async function getFacebookCookieSnapshot() {
  try {
    let cookies = await chrome.cookies.getAll({ domain: ".facebook.com" });
    if (!Array.isArray(cookies) || cookies.length === 0) {
      const fallbackCookies = await chrome.cookies.getAll({ url: "https://www.facebook.com/" });
      cookies = Array.isArray(fallbackCookies) ? fallbackCookies : [];
    }

    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const cUser = cookies.find((c) => c.name === "c_user");

    return {
      success: !!cookieString,
      cookieString,
      userId: cUser?.value || "",
      cookieCount: cookies.length,
      reason: cookieString ? null : "no_cookies",
    };
  } catch (error) {
    return {
      success: false,
      cookieString: "",
      userId: "",
      cookieCount: 0,
      reason: isMissingHostPermissionError(error)
        ? "missing_host_permission"
        : "cookie_query_failed",
      error: error?.message || String(error),
    };
  }
}

async function listUniqueTabsByPatterns(patterns = []) {
  const tabMap = new Map();
  for (const pattern of patterns) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern });
      tabs.forEach((tab) => {
        if (tab?.id) {
          tabMap.set(tab.id, tab);
        }
      });
    } catch (_) {
      // Ignore query errors per-pattern and continue.
    }
  }
  return Array.from(tabMap.values());
}

async function isMarkerActive(tabId, markerKey) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (key) => !!globalThis[key],
      args: [markerKey],
    });
    return !!results?.[0]?.result;
  } catch (_) {
    return false;
  }
}

async function ensureScriptInjected(tabId, markerKey, fileName) {
  const alreadyActive = await isMarkerActive(tabId, markerKey);
  if (alreadyActive) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [fileName],
    });
    return true;
  } catch (error) {
    console.warn("[FEWFEED] Script injection failed:", fileName, "tab:", tabId, error?.message || error);
    return false;
  }
}

async function injectScriptsIntoExistingTabs() {
  const appTabs = await listUniqueTabsByPatterns(APP_URLS);
  for (const tab of appTabs) {
    if (!tab?.id) continue;
    await ensureScriptInjected(tab.id, "__PUBILO_CONTENT_SCRIPT_ACTIVE__", "content.js");
  }

  const fbTabs = await listUniqueTabsByPatterns(FB_TAB_URLS);
  for (const tab of fbTabs) {
    if (!tab?.id) continue;
    await ensureScriptInjected(tab.id, "__PUBILO_FB_CONTENT_SCRIPT_ACTIVE__", "fb-content.js");
  }
}

function urlMatchesPatterns(url, patterns = []) {
  if (!url) return false;
  return patterns.some((pattern) => {
    const regex = new RegExp("^" + pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*") + "$");
    return regex.test(url);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab?.url) return;

  if (urlMatchesPatterns(tab.url, APP_URLS)) {
    ensureScriptInjected(tabId, "__PUBILO_CONTENT_SCRIPT_ACTIVE__", "content.js").catch(() => { });
  }

  if (urlMatchesPatterns(tab.url, FB_TAB_URLS)) {
    ensureScriptInjected(tabId, "__PUBILO_FB_CONTENT_SCRIPT_ACTIVE__", "fb-content.js").catch(() => { });
  }
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  const cookie = changeInfo?.cookie;
  const domain = String(cookie?.domain || "");
  const name = String(cookie?.name || "");
  if (!domain.includes("facebook.com")) return;
  if (!["c_user", "xs"].includes(name)) return;
  scheduleFacebookSessionRefresh(`cookie_${name}_${changeInfo.removed ? "removed" : "updated"}`);
});

// When extension icon is clicked
chrome.action.onClicked.addListener(async () => {
  console.log("[Pubilo] Extension clicked!");

  // Open production URL (use localhost for dev)
  chrome.tabs.create({ url: PRODUCTION_URL });

  // Fetch all tokens in background
  await fetchAllTokensInBackground();
  injectScriptsIntoExistingTabs().catch(() => { });
});

// Fetch all tokens in background (Ads Token + Cookie only)
async function fetchAllTokensInBackground() {
  await fetchAndStoreToken();
}

// Extract token from existing Facebook tabs using script injection
async function extractTokenFromExistingTabs() {
  console.log("[FEWFEED] Trying to extract token from existing tabs...");

  const tabs = await listUniqueTabsByPatterns([
    "https://adsmanager.facebook.com/*",
    "https://business.facebook.com/*",
    "https://facebook.com/*",
    "https://www.facebook.com/*",
  ]);

  const tokenCandidates = [];
  let bestDtsg = "";

  for (const tab of tabs || []) {
    if (!tab?.id) continue;

    try {
      await ensureScriptInjected(tab.id, "__PUBILO_FB_CONTENT_SCRIPT_ACTIVE__", "fb-content.js");
    } catch (_) {
      // Ignore injection errors; fallback extraction below may still work.
    }

    try {
      const mainWorldResult = await executeTokenProbeInTab(tab.id, "MAIN");
      if (Array.isArray(mainWorldResult?.candidates)) {
        tokenCandidates.push(...mainWorldResult.candidates);
      }
      const tokenFromMain = String(mainWorldResult?.token || "").trim();
      const dtsgFromMain = String(mainWorldResult?.dtsg || "").trim();
      if (tokenFromMain) {
        tokenCandidates.push(tokenFromMain);
      }
      if (dtsgFromMain && !bestDtsg) {
        bestDtsg = dtsgFromMain;
      }
    } catch (_) {
      // Ignore per-tab main world extraction errors.
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "extractToken" });
      const tokenFromMessage = String(response?.token || "").trim();
      const dtsgFromMessage = String(response?.dtsg || "").trim();
      if (tokenFromMessage) {
        tokenCandidates.push(tokenFromMessage);
      }
      if (dtsgFromMessage && !bestDtsg) {
        bestDtsg = dtsgFromMessage;
      }
    } catch (_) {
      // Ignore missing receiver errors and try executeScript fallback.
    }

    try {
      const fallbackResult = await executeTokenProbeInTab(tab.id, "ISOLATED");
      if (Array.isArray(fallbackResult?.candidates)) {
        tokenCandidates.push(...fallbackResult.candidates);
      }
      const tokenFromScript = String(fallbackResult?.token || "").trim();
      const dtsgFromScript = String(fallbackResult?.dtsg || "").trim();
      if (tokenFromScript) {
        tokenCandidates.push(tokenFromScript);
      }
      if (dtsgFromScript && !bestDtsg) {
        bestDtsg = dtsgFromScript;
      }
    } catch (_) {
      // Ignore executeScript failures per-tab.
    }
  }

  const rankedCandidates = rankAccessTokenCandidates(tokenCandidates);
  const bestToken = rankedCandidates[0] || "";
  if (bestToken) {
    console.log("[FEWFEED] Extracted token from existing tabs:", bestToken.substring(0, 15) + "...");
    return { token: bestToken, dtsg: bestDtsg || null, candidates: rankedCandidates };
  }

  if (!tabs.length) {
    console.log("[FEWFEED] No Facebook tabs available for token extraction");
  }
  console.log("[FEWFEED] No token found in existing tabs");
  return null;
}

function waitForTabComplete(tabId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let timeout = null;

    const done = (ok, error) => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (ok) resolve(true);
      else reject(error || new Error("tab_load_timeout"));
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        done(true);
      }
    };

    timeout = setTimeout(() => {
      done(false, new Error("tab_load_timeout"));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function extractTokenViaTemporaryTab(url) {
  let tabId = null;
  try {
    const createdTab = await chrome.tabs.create({ url, active: false });
    tabId = createdTab?.id;
    if (!tabId) return null;

    await waitForTabComplete(tabId, 15000);
    await ensureScriptInjected(tabId, "__PUBILO_FB_CONTENT_SCRIPT_ACTIVE__", "fb-content.js");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    let bestDtsg = "";
    // MAIN-world probe retries: Facebook sometimes hydrates token a bit after load complete.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mainResult = await executeTokenProbeInTab(tabId, "MAIN");
        if (Array.isArray(mainResult?.candidates) && mainResult.candidates.length > 0) {
          const ranked = rankAccessTokenCandidates(mainResult.candidates);
          const token = String(ranked[0] || mainResult.token || "").trim();
          const dtsg = String(mainResult?.dtsg || "").trim();
          if (dtsg && !bestDtsg) {
            bestDtsg = dtsg;
          }
          if (token) {
            return {
              token,
              dtsg: dtsg || bestDtsg || null,
              source: `temporary_tab_main_world_attempt_${attempt + 1}`,
              candidates: ranked,
            };
          }
        }
      } catch (_) {
        // Continue to next fallback/retry.
      }
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
    }

    let response = null;
    try {
      response = await chrome.tabs.sendMessage(tabId, { action: "extractToken" });
    } catch (_) {
      response = null;
    }

    const token = String(response?.token || "").trim();
    const dtsg = String(response?.dtsg || "").trim();
    if (token) {
      return { token, dtsg: dtsg || bestDtsg || null, source: "temporary_tab" };
    }

    const fallbackResult = await executeTokenProbeInTab(tabId, "ISOLATED");
    const fallbackToken = String(fallbackResult?.token || "").trim();
    const fallbackDtsg = String(fallbackResult?.dtsg || "").trim();
    if (fallbackToken) {
      return {
        token: fallbackToken,
        dtsg: dtsg || fallbackDtsg || bestDtsg || null,
        source: "temporary_tab_fallback",
      };
    }

    return null;
  } catch (error) {
    console.warn("[FEWFEED] Temporary tab token extraction failed:", url, error?.message || error);
    return null;
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {}
    }
  }
}

// Main function to fetch ads token from Facebook using cookies
async function fetchAndStoreToken() {
  try {
    const previousData = await chrome.storage.local.get([
      "fewfeed_accessToken",
      "fewfeed_token",
      "fewfeed_fbDtsg",
      "fewfeed_userId",
      "fewfeed_userName",
      "fewfeed_cookie",
      "fewfeed_avatarUrl",
      PAGE_TOKEN_MAP_KEY,
      PAGE_TOKEN_MAP_OWNER_KEY,
    ]);
    const cookieSnapshot = await getFacebookCookieSnapshot();
    const cookieString = cookieSnapshot.cookieString || "";
    const userId = cookieSnapshot.userId || "";
    const previousPageTokenMapOwnerId = String(
      previousData[PAGE_TOKEN_MAP_OWNER_KEY] || previousData.fewfeed_userId || "",
    ).trim();
    const canReusePreviousPageTokenMap =
      !!userId && previousPageTokenMapOwnerId === String(userId).trim();

    if (!cookieString) {
      console.log("[FEWFEED] No Facebook cookies found");
      await chrome.storage.local.set({
        fewfeed_ready: !!(
          previousData.fewfeed_accessToken ||
          previousData.fewfeed_cookie
        ),
        fewfeed_lastFetch: Date.now()
      });
      return {
        success: false,
        reason: cookieSnapshot.reason || "no_cookies",
        error: cookieSnapshot.error || null,
      };
    }

    if (!userId) {
      console.log("[FEWFEED] Found Facebook cookies but no c_user cookie (session may be restricted)");
    } else {
      console.log("[FEWFEED] Found Facebook cookies for user:", userId);
    }

    // Persist cookie early so content script/web can use it immediately even if token fetch is slow.
    await chrome.storage.local.set({
      fewfeed_cookie: cookieString,
      fewfeed_userId: userId || previousData.fewfeed_userId || "",
      fewfeed_userName: previousData.fewfeed_userName || "Facebook User",
      fewfeed_ready: true,
      fewfeed_lastFetch: Date.now(),
    });

    // Try to fetch token from Facebook endpoints
    let accessToken = null;
    let fbDtsg = null;
    let userName = "Facebook User";

    // NEW Method 0: Try extracting from existing Facebook tabs first (most reliable)
    const tabResult = await extractTokenFromExistingTabs();
    if (tabResult) {
      accessToken = tabResult.token;
      fbDtsg = tabResult.dtsg;
      console.log("[FEWFEED] Got token from existing tab!");
    }

    if (!accessToken) {
      const tempAdsResult = await extractTokenViaTemporaryTab("https://adsmanager.facebook.com/adsmanager/manage/campaigns");
      if (tempAdsResult?.token) {
        accessToken = tempAdsResult.token;
        fbDtsg = fbDtsg || tempAdsResult.dtsg;
        console.log("[FEWFEED] Got token from temporary Ads Manager tab!");
      }
    }

    if (!accessToken) {
      const tempBusinessResult = await extractTokenViaTemporaryTab("https://business.facebook.com/latest/home");
      if (tempBusinessResult?.token) {
        accessToken = tempBusinessResult.token;
        fbDtsg = fbDtsg || tempBusinessResult.dtsg;
        console.log("[FEWFEED] Got token from temporary Business tab!");
      }
    }

    // Method 1: Try fetching from Ads Manager API (fallback)
    if (!accessToken) {
      const adsResult = await fetchTokenFromAdsManager(cookieString, true);
      if (typeof adsResult === 'object') {
        accessToken = adsResult.token;
        fbDtsg = fbDtsg || adsResult.dtsg;
      } else {
        accessToken = adsResult;
      }
    }

    // Method 2: Try fetching from Business Suite
    if (!accessToken) {
      const bizResult = await fetchTokenFromBusinessSuite(cookieString, true);
      if (typeof bizResult === 'object') {
        accessToken = bizResult.token;
        fbDtsg = fbDtsg || bizResult.dtsg;
      } else {
        accessToken = bizResult;
      }
    }

    // Method 3: Try fetching from regular Facebook
    if (!accessToken) {
      const fbResult = await fetchTokenFromFacebook(cookieString, true);
      if (typeof fbResult === 'object') {
        accessToken = fbResult.token;
        fbDtsg = fbDtsg || fbResult.dtsg;
      } else {
        accessToken = fbResult;
      }
    }

    // Method 4: Try using internal API endpoint
    if (!accessToken) {
      accessToken = await fetchTokenFromInternalAPI(cookieString);
    }

    // If still no fb_dtsg, try fetching from business.facebook.com specifically
    if (!fbDtsg) {
      fbDtsg = await fetchDtsgFromBusiness(cookieString);
    }

    // Validate token before storing. Some extraction patterns can return stale/invalid EA strings.
    if (accessToken) {
      const tokenCandidates = [];
      if (tabResult?.candidates && Array.isArray(tabResult.candidates)) {
        tokenCandidates.push(...tabResult.candidates);
      }
      tokenCandidates.push(accessToken);
      const dedupCandidates = Array.from(
        new Set(tokenCandidates.map((value) => String(value || "").trim()).filter(Boolean)),
      );

      let selectedToken = "";
      let selectedValidation = null;
      for (const candidate of dedupCandidates) {
        const candidateValidation = await validateGraphAccessToken(candidate, userId, cookieString);
        if (candidateValidation.ok) {
          selectedToken = candidate;
          selectedValidation = candidateValidation;
          break;
        }
        if (!selectedValidation || selectedValidation.reason !== "network_error") {
          selectedValidation = candidateValidation;
        }
      }

      if (selectedToken) {
        accessToken = selectedToken;
      }

      const validation =
        selectedToken
          ? selectedValidation
          : (await validateGraphAccessToken(accessToken, userId, cookieString));
      if (!validation.ok) {
        if (validation.reason === "network_error") {
          console.warn("[FEWFEED] Access token validation network error, keeping token candidate:", validation.error);
        } else {
          console.warn("[FEWFEED] Discarding invalid access token:", validation.reason, validation.error || "");
          accessToken = null;
          fbDtsg = null;
        }
      } else if (validation.userMismatch) {
        console.warn(
          "[FEWFEED] Access token validated but Graph user id differs from c_user. Keeping token.",
          "expected:",
          validation.expectedUserId || "(none)",
          "graph:",
          validation.graphId || "(none)",
        );
      }
    }

    // Fallback: if fresh extraction failed, reuse previous token from the same account
    // when it still validates (or validation endpoint is temporarily unreachable).
    if (!accessToken) {
      const previousAccessToken = String(
        previousData.fewfeed_accessToken || previousData.fewfeed_token || "",
      ).trim();
      const previousUserId = String(previousData.fewfeed_userId || "").trim();
      const canReusePreviousAccessToken = !!(
        previousAccessToken &&
        userId &&
        previousUserId &&
        previousUserId === String(userId).trim()
      );

      if (canReusePreviousAccessToken) {
        const previousValidation = await validateGraphAccessToken(previousAccessToken, userId, cookieString);
        if (previousValidation.ok || previousValidation.reason === "network_error") {
          accessToken = previousAccessToken;
          console.log(
            "[FEWFEED] Reused previous access token for same account:",
            previousValidation.ok ? "validated" : "network-validation-fallback",
          );
          if (!fbDtsg && previousData.fewfeed_fbDtsg) {
            fbDtsg = previousData.fewfeed_fbDtsg;
          }
        } else {
          console.warn("[FEWFEED] Previous access token rejected:", previousValidation.reason);
        }
      }
    }

    // Fetch user name and avatar from Graph API if we have access token
    let avatarUrl = null;
    let graphUserIdFromToken = "";
    if (accessToken) {
      try {
        const nameResponse = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,picture.width(200).height(200)&access_token=${accessToken}`);
        const userData = await nameResponse.json();
        if (userData.id) {
          graphUserIdFromToken = String(userData.id).trim();
        }
        if (userData.name) {
          userName = userData.name;
          console.log("[FEWFEED] Fetched user name:", userName);
        }
        if (userData.picture?.data?.url) {
          avatarUrl = userData.picture.data.url;
          console.log("[FEWFEED] Fetched avatar URL");
        }
      } catch (e) {
        console.log("[FEWFEED] Could not fetch user info:", e.message);
      }
    }

    console.log("[FEWFEED] Result:", {
      userId: userId || graphUserIdFromToken,
      userName,
      hasAdsToken: !!accessToken,
      hasDtsg: !!fbDtsg,
      hasCookie: !!cookieString,
      hasAvatar: !!avatarUrl
    });

    const hasFreshAccessToken = !!accessToken;
    const hasFreshDtsg = !!fbDtsg;

    // Store for content script.
    // Important: do not keep stale access token/dtsg when fresh fetch fails,
    // otherwise the app keeps sending invalid token (code 190) forever.
    const storageData = {
      fewfeed_accessToken: hasFreshAccessToken ? accessToken : "",
      fewfeed_token: hasFreshAccessToken ? accessToken : "",
      fewfeed_fbDtsg: hasFreshDtsg ? fbDtsg : "",
      [ACCESS_TOKEN_VALIDATED_AT_KEY]: hasFreshAccessToken ? Date.now() : 0,
      [ACCESS_TOKEN_VALIDATION_STATUS_KEY]: hasFreshAccessToken ? "valid" : "missing",
      fewfeed_userId: userId || graphUserIdFromToken || previousData.fewfeed_userId || "",
      fewfeed_userName:
        (userName && userName !== "Facebook User")
          ? userName
          : (previousData.fewfeed_userName || "Facebook User"),
      fewfeed_cookie: cookieString || previousData.fewfeed_cookie || "",
      fewfeed_ready: !!(cookieString || hasFreshAccessToken),
      fewfeed_lastFetch: Date.now()
    };
    if (avatarUrl) {
      storageData.fewfeed_avatarUrl = avatarUrl;
    } else if (previousData.fewfeed_avatarUrl) {
      storageData.fewfeed_avatarUrl = previousData.fewfeed_avatarUrl;
    }
    await chrome.storage.local.set(storageData);

    // After storing ads token, also fetch and store page tokens so they
    // survive even when the ads token expires later.
    let pageTokenMap = {};
    const previousPageTokenMap = canReusePreviousPageTokenMap
      ? parseStoredPageTokenMap(previousData[PAGE_TOKEN_MAP_KEY])
      : {};
    if (previousPageTokenMapOwnerId && userId && previousPageTokenMapOwnerId !== String(userId).trim()) {
      console.log("[FEWFEED] Facebook account changed, clearing previous page token map owner:", previousPageTokenMapOwnerId, "->", userId);
    }
    const effectiveAccessToken = hasFreshAccessToken ? storageData.fewfeed_accessToken : "";
    if (effectiveAccessToken || cookieString) {
      try {
        const pagesResult = await fetchFacebookPages(effectiveAccessToken || "", cookieString);
        if (pagesResult?.success && Array.isArray(pagesResult.pages)) {
          for (const page of pagesResult.pages) {
            if (page.id && page.access_token) {
              pageTokenMap[String(page.id)] = {
                token: page.access_token,
                name: page.name || "",
                picture: page.picture?.data?.url || "",
              };
            }
          }
          console.log("[FEWFEED] Stored page tokens for", Object.keys(pageTokenMap).length, "pages");
          if (Object.keys(pageTokenMap).length === 0 && Object.keys(previousPageTokenMap).length > 0) {
            pageTokenMap = previousPageTokenMap;
            console.log("[FEWFEED] Kept previous page token map because refresh returned empty");
          }
        }
      } catch (pageErr) {
        console.warn("[FEWFEED] Failed to fetch page tokens:", pageErr?.message || pageErr);
        if (Object.keys(previousPageTokenMap).length > 0) {
          pageTokenMap = previousPageTokenMap;
          console.log("[FEWFEED] Kept previous page token map due to fetch error");
        }
      }
    } else if (Object.keys(previousPageTokenMap).length > 0) {
      pageTokenMap = previousPageTokenMap;
      console.log("[FEWFEED] No valid ads token, using previous page token map");
    }

    storageData[PAGE_TOKEN_MAP_KEY] = JSON.stringify(pageTokenMap);
    storageData[PAGE_TOKEN_MAP_OWNER_KEY] = userId || "";
    storageData.fewfeed_ready = !!(
      storageData.fewfeed_cookie ||
      storageData.fewfeed_accessToken ||
      Object.keys(pageTokenMap).length > 0
    );
    await chrome.storage.local.set(storageData);

    console.log("[FEWFEED] Ads token, fb_dtsg, cookies and page tokens stored!");
    return {
      success: !!(storageData.fewfeed_accessToken || storageData.fewfeed_cookie),
      hasAdsToken: !!storageData.fewfeed_accessToken,
      hasCookie: !!storageData.fewfeed_cookie,
      hasPageTokens: Object.keys(pageTokenMap).length > 0,
      reason: hasFreshAccessToken ? null : "no_access_token",
      userId: userId || "",
    };

  } catch (error) {
    console.error("[FEWFEED] Error:", error);
    return {
      success: false,
      reason: isMissingHostPermissionError(error)
        ? "missing_host_permission"
        : "exception",
      error: error?.message || String(error),
    };
  }
}

// Fetch fb_dtsg from Business Facebook
async function fetchDtsgFromBusiness(cookieString) {
  try {
    const response = await fetch("https://business.facebook.com/content_management/", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    return extractDtsgFromHTML(html);
  } catch (e) {
    console.log("[FEWFEED] Business dtsg fetch failed:", e.message);
    return null;
  }
}

// Fetch token from Ads Manager page
async function fetchTokenFromAdsManager(cookieString, includeDtsg = false) {
  try {
    const response = await fetch("https://adsmanager.facebook.com/adsmanager/manage/campaigns", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    const token = extractTokenFromHTML(html);

    if (includeDtsg) {
      const dtsg = extractDtsgFromHTML(html);
      return { token, dtsg };
    }
    return token;
  } catch (e) {
    console.log("[FEWFEED] Ads Manager fetch failed:", e.message);
    return includeDtsg ? { token: null, dtsg: null } : null;
  }
}

// Fetch token from Business Suite page
async function fetchTokenFromBusinessSuite(cookieString, includeDtsg = false) {
  try {
    const response = await fetch("https://business.facebook.com/", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    const token = extractTokenFromHTML(html);

    if (includeDtsg) {
      const dtsg = extractDtsgFromHTML(html);
      return { token, dtsg };
    }
    return token;
  } catch (e) {
    console.log("[FEWFEED] Business Suite fetch failed:", e.message);
    return includeDtsg ? { token: null, dtsg: null } : null;
  }
}

// Fetch token from regular Facebook
async function fetchTokenFromFacebook(cookieString, includeDtsg = false) {
  try {
    const response = await fetch("https://www.facebook.com/", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const html = await response.text();
    const token = extractTokenFromHTML(html);

    if (includeDtsg) {
      const dtsg = extractDtsgFromHTML(html);
      return { token, dtsg };
    }
    return token;
  } catch (e) {
    console.log("[FEWFEED] Facebook fetch failed:", e.message);
    return includeDtsg ? { token: null, dtsg: null } : null;
  }
}

// Try internal API endpoint that might return token
async function fetchTokenFromInternalAPI(cookieString) {
  try {
    const response = await fetch("https://www.facebook.com/ajax/bootloader-endpoint/?modules=AdsLWIDescribeCustomersTypedLogger", {
      headers: {
        "Cookie": cookieString,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      credentials: "include"
    });

    const text = await response.text();
    return extractTokenFromHTML(text);
  } catch (e) {
    console.log("[FEWFEED] Internal API fetch failed:", e.message);
    return null;
  }
}

// Extract token from HTML/text response
function extractTokenFromHTML(html) {
  const TOKEN_CHARS = "[A-Za-z0-9_-]+";
  const patterns = [
    // __accessToken assignment in HTML
    new RegExp(`__accessToken\\s*=\\s*"(EA${TOKEN_CHARS})"`),
    new RegExp(`"__accessToken"\\s*:\\s*"(EA${TOKEN_CHARS})"`),
    // NEW: __window.__accessToken format (Facebook 2024+)
    new RegExp(`__window\\.__accessToken="(EAABsbCS${TOKEN_CHARS})"`),
    new RegExp(`__window\\.__accessToken="(EA${TOKEN_CHARS})"`),

    // EAABsbCS format (internal token)
    new RegExp(`"accessToken":\\s*"(EAABsbCS${TOKEN_CHARS})"`),
    new RegExp(`"access_token":\\s*"(EAABsbCS${TOKEN_CHARS})"`),
    new RegExp(`accessToken['"]\\s*:\\s*['"](EAABsbCS${TOKEN_CHARS})['"]`),

    // EAAChZC format (OAuth token) - also valid but less preferred
    new RegExp(`"accessToken":\\s*"(EA${TOKEN_CHARS})"`),
    new RegExp(`"access_token":\\s*"(EA${TOKEN_CHARS})"`),
    new RegExp(`access_token=(EA${TOKEN_CHARS})`),
    new RegExp(`"token":\\s*"(EA${TOKEN_CHARS})"`),
    new RegExp(`accessToken['"]\\s*:\\s*['"](EA${TOKEN_CHARS})['"]`),

    // EAAG format
    new RegExp(`"accessToken":\\s*"(EAAG${TOKEN_CHARS})"`)
  ];

  const escapedPatterns = [
    new RegExp(`\\\\"__accessToken\\\\"\\s*:\\s*\\\\"(EA${TOKEN_CHARS})\\\\"`),
    new RegExp(`\\\\"accessToken\\\\"\\s*:\\s*\\\\"(EA${TOKEN_CHARS})\\\\"`),
    new RegExp(`\\\\"access_token\\\\"\\s*:\\s*\\\\"(EA${TOKEN_CHARS})\\\\"`),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      console.log("[FEWFEED] Token found with pattern:", pattern.toString().substring(0, 30));
      return match[1];
    }
  }

  for (const pattern of escapedPatterns) {
    const match = html.match(pattern);
    if (match) {
      console.log("[FEWFEED] Token found with escaped pattern:", pattern.toString().substring(0, 30));
      return match[1];
    }
  }
  return null;
}

// Extract fb_dtsg token from HTML (required for GraphQL scheduling)
function extractDtsgFromHTML(html) {
  const patterns = [
    // DTSGInitialData format
    /"DTSGInitialData"[^}]*"token":"([^"]+)"/,
    // fb_dtsg in form
    /name="fb_dtsg"\s+value="([^"]+)"/,
    // fb_dtsg in JSON
    /"fb_dtsg":\s*"([^"]+)"/,
    /fb_dtsg['"]\s*:\s*['"]([\w:_-]+)['"]/,
    // DTSG token format
    /"dtsg":\s*\{"token":"([^"]+)"/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      console.log("[FEWFEED] fb_dtsg found with pattern:", pattern.toString().substring(0, 40));
      return match[1];
    }
  }
  return null;
}

async function handleTokenExtractedMessage(request = {}) {
  const extractedToken = String(request.token || "").trim();
  const extractedDtsg = String(request.dtsg || "").trim();
  const extractedAvatarUrl = String(request.avatarUrl || "").trim();
  const source = String(request.source || "unknown").trim();

  if (!extractedToken && !extractedDtsg && !extractedAvatarUrl) {
    return { success: true, applied: false, reason: "empty_payload" };
  }

  const existingData = await chrome.storage.local.get([
    "fewfeed_accessToken",
    "fewfeed_token",
    "fewfeed_fbDtsg",
    "fewfeed_userId",
    "fewfeed_cookie",
    ACCESS_TOKEN_VALIDATED_AT_KEY,
    ACCESS_TOKEN_VALIDATION_STATUS_KEY,
  ]);
  const cookieSnapshot = await getFacebookCookieSnapshot();
  const cookieString = String(cookieSnapshot.cookieString || existingData.fewfeed_cookie || "").trim();
  const expectedUserId = String(cookieSnapshot.userId || existingData.fewfeed_userId || "").trim();

  const updates = {
    fewfeed_lastFetch: Date.now(),
  };
  if (cookieString) {
    updates.fewfeed_cookie = cookieString;
  }
  if (expectedUserId) {
    updates.fewfeed_userId = expectedUserId;
  }

  let acceptedToken = "";
  let tokenValidation = null;

  if (extractedToken) {
    tokenValidation = await validateGraphAccessToken(
      extractedToken,
      expectedUserId,
      cookieString,
    );

    if (tokenValidation.ok) {
      acceptedToken = extractedToken;
      updates.fewfeed_accessToken = extractedToken;
      updates.fewfeed_token = extractedToken;
      updates[ACCESS_TOKEN_VALIDATED_AT_KEY] = Date.now();
      updates[ACCESS_TOKEN_VALIDATION_STATUS_KEY] = tokenValidation.userMismatch ? "valid_user_mismatch" : "valid";
      if (tokenValidation.graphId && !expectedUserId) {
        updates.fewfeed_userId = tokenValidation.graphId;
      }
    } else {
      updates[ACCESS_TOKEN_VALIDATED_AT_KEY] = Date.now();
      updates[ACCESS_TOKEN_VALIDATION_STATUS_KEY] = tokenValidation.reason || "invalid";
      console.warn(
        "[FEWFEED] Ignored token extracted from page because validation failed:",
        tokenValidation.reason,
        tokenValidation.error || "",
        "| source:",
        source,
      );
    }
  }

  if (extractedDtsg && (acceptedToken || existingData.fewfeed_accessToken || existingData.fewfeed_token)) {
    updates.fewfeed_fbDtsg = extractedDtsg;
  }

  if (extractedAvatarUrl) {
    updates.fewfeed_avatarUrl = extractedAvatarUrl;
  }

  const resultingToken = acceptedToken || String(
    existingData.fewfeed_accessToken || existingData.fewfeed_token || "",
  ).trim();
  updates.fewfeed_ready = !!(resultingToken || cookieString);

  await chrome.storage.local.set(updates);
  await notifyAppTabsSessionUpdated("token_extracted");

  return {
    success: true,
    applied: true,
    hasToken: !!resultingToken,
    hasCookie: !!cookieString,
    tokenAccepted: !!acceptedToken,
    validationReason: tokenValidation?.reason || null,
  };
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const replyError = (error, extra = {}) => {
    const message = error?.message || String(error || "Unknown error");
    sendResponse({ success: false, error: message, ...extra });
  };

  // Token extracted from Facebook page by fb-content.js
  if (request.action === "tokenExtracted") {
    console.log("[FEWFEED] Token received from fb-content.js:", {
      hasToken: !!request.token,
      hasDtsg: !!request.dtsg,
      hasAvatar: !!request.avatarUrl,
      source: request.source
    });

    (async () => {
      try {
        const result = await handleTokenExtractedMessage(request);
        sendResponse(result);
      } catch (error) {
        replyError(error, { reason: "token_extracted_failed" });
      }
    })();
    return true;
  }

  // Get Facebook cookies for popup (checks if logged in)
  if (request.action === "getFacebookCookies") {
    (async () => {
      try {
        const snapshot = await getFacebookCookieSnapshot();
        if (snapshot.success && snapshot.cookieString) {
          sendResponse({
            success: true,
            cookie: snapshot.cookieString,
            userId: snapshot.userId || ""
          });
        } else {
          sendResponse({
            success: false,
            reason: snapshot.reason || "no_cookies",
            error: snapshot.error || "Not logged into Facebook"
          });
        }
      } catch (err) {
        sendResponse({
          success: false,
          reason: isMissingHostPermissionError(err)
            ? "missing_host_permission"
            : "exception",
          error: err.message
        });
      }
    })();
    return true;
  }

  if (request.action === "getStoredData") {
    (async () => {
      try {
        const readKeys = [
          "fewfeed_accessToken",
          "fewfeed_token",
          "fewfeed_fbDtsg",
          "fewfeed_userId",
          "fewfeed_userName",
          "fewfeed_cookie",
          "fewfeed_ready",
          "fewfeed_lastFetch",
          ACCESS_TOKEN_VALIDATED_AT_KEY,
          ACCESS_TOKEN_VALIDATION_STATUS_KEY,
          PAGE_TOKEN_MAP_KEY,
          PAGE_TOKEN_MAP_OWNER_KEY,
          "fewfeed_avatarUrl"
        ];
        let data = await chrome.storage.local.get(readKeys);
        const cookieSnapshot = await getFacebookCookieSnapshot();
        const currentCookieUserId = String(cookieSnapshot.userId || "").trim();
        const storedUserId = String(data.fewfeed_userId || "").trim();
        const accountChanged = !!(
          currentCookieUserId &&
          storedUserId &&
          currentCookieUserId !== storedUserId
        );

        // Keep FEWFEED_GET_DATA fast: return cached values immediately and refresh async.
        if (accountChanged) {
          console.log("[FEWFEED] Account changed, clearing stale token cache and scheduling refresh:", storedUserId, "->", currentCookieUserId);
          await chrome.storage.local.set({
            fewfeed_accessToken: "",
            fewfeed_token: "",
            fewfeed_fbDtsg: "",
            fewfeed_userId: currentCookieUserId || "",
            fewfeed_userName: "",
            fewfeed_avatarUrl: "",
            fewfeed_cookie: cookieSnapshot.cookieString || "",
            [PAGE_TOKEN_MAP_KEY]: "{}",
            [PAGE_TOKEN_MAP_OWNER_KEY]: currentCookieUserId || "",
            fewfeed_ready: !!cookieSnapshot.cookieString,
            fewfeed_lastFetch: Date.now(),
            [ACCESS_TOKEN_VALIDATED_AT_KEY]: 0,
            [ACCESS_TOKEN_VALIDATION_STATUS_KEY]: "account_changed",
          });
          data = await chrome.storage.local.get(readKeys);
          scheduleAutoSessionRefresh("account_changed");
        } else {
          const hasPageTokenMap = (() => {
            const parsed = parseStoredPageTokenMap(data[PAGE_TOKEN_MAP_KEY]);
            return Object.keys(parsed).length > 0;
          })();
          const hasAccessToken = !!String(data.fewfeed_accessToken || data.fewfeed_token || "").trim();
          const hasUsableSession = !!(hasAccessToken || hasPageTokenMap);
          const lastFetchAt = Number(data.fewfeed_lastFetch || 0);
          const shouldRefreshMissingAdsToken = !!(
            !hasAccessToken &&
            data.fewfeed_cookie &&
            (!lastFetchAt || (Date.now() - lastFetchAt) > 60 * 1000)
          );
          const tokenCheckedAt = Number(data[ACCESS_TOKEN_VALIDATED_AT_KEY] || 0);
          const shouldRevalidateAccessToken = !!(
            hasAccessToken &&
            (!tokenCheckedAt || (Date.now() - tokenCheckedAt) > ACCESS_TOKEN_REVALIDATE_INTERVAL_MS)
          );

          if (!hasUsableSession || shouldRefreshMissingAdsToken || shouldRevalidateAccessToken) {
            scheduleAutoSessionRefresh(
              !hasUsableSession
                ? "missing_session"
                : shouldRefreshMissingAdsToken
                  ? "missing_ads_token"
                  : "revalidate_stale_access_token",
            );
          }
        }

        sendResponse({
          success: true,
          extensionVersion: chrome.runtime.getManifest().version,
          accessToken: data.fewfeed_accessToken,
          fewfeed_token: data.fewfeed_token || "",
          fbDtsg: data.fewfeed_fbDtsg,
          userId: data.fewfeed_userId,
          userName: data.fewfeed_userName,
          avatarUrl: data.fewfeed_avatarUrl || "",
          cookie: data.fewfeed_cookie,
          ready: data.fewfeed_ready,
          fewfeed_accessTokenValidatedAt: data[ACCESS_TOKEN_VALIDATED_AT_KEY] || 0,
          fewfeed_accessTokenValidationStatus: data[ACCESS_TOKEN_VALIDATION_STATUS_KEY] || "",
          pageTokenMap: data[PAGE_TOKEN_MAP_KEY] || "{}",
          pageTokenMapOwnerId: data[PAGE_TOKEN_MAP_OWNER_KEY] || ""
        });
      } catch (error) {
        replyError(error);
      }
    })();
    return true;
  }

  // Manually trigger token fetch - waits for completion
  if (request.action === "fetchToken") {
    (async () => {
      try {
        // Token extraction can take longer when fallback opens temporary Facebook tabs.
        const fetchResult = await Promise.race([
          fetchAndStoreToken(),
          new Promise((resolve) => setTimeout(() => resolve({ success: false, reason: "timeout" }), 12000)),
        ]);

        const data = await chrome.storage.local.get([
          "fewfeed_accessToken",
          "fewfeed_token",
          "fewfeed_fbDtsg",
          "fewfeed_userId",
          "fewfeed_userName",
          "fewfeed_cookie",
          "fewfeed_avatarUrl",
          ACCESS_TOKEN_VALIDATED_AT_KEY,
          ACCESS_TOKEN_VALIDATION_STATUS_KEY,
          PAGE_TOKEN_MAP_KEY,
          PAGE_TOKEN_MAP_OWNER_KEY,
        ]);
        sendResponse({
          success: !!(data.fewfeed_accessToken || data.fewfeed_cookie),
          extensionVersion: chrome.runtime.getManifest().version,
          ...data,
          pageTokenMap: data[PAGE_TOKEN_MAP_KEY] || "{}",
          pageTokenMapOwnerId: data[PAGE_TOKEN_MAP_OWNER_KEY] || "",
          debug: fetchResult || { success: false, reason: "timeout" },
        });
      } catch (error) {
        try {
          const fallback = await chrome.storage.local.get([
            "fewfeed_accessToken",
            "fewfeed_token",
            "fewfeed_fbDtsg",
            "fewfeed_userId",
            "fewfeed_userName",
            "fewfeed_cookie",
            "fewfeed_avatarUrl",
            ACCESS_TOKEN_VALIDATED_AT_KEY,
            ACCESS_TOKEN_VALIDATION_STATUS_KEY,
            PAGE_TOKEN_MAP_KEY,
            PAGE_TOKEN_MAP_OWNER_KEY,
          ]);
          sendResponse({
            success: !!(fallback.fewfeed_accessToken || fallback.fewfeed_cookie),
            extensionVersion: chrome.runtime.getManifest().version,
            ...fallback,
            pageTokenMap: fallback[PAGE_TOKEN_MAP_KEY] || "{}",
            pageTokenMapOwnerId: fallback[PAGE_TOKEN_MAP_OWNER_KEY] || "",
            warning: error?.message || String(error),
            debug: { success: false, reason: "exception" },
          });
        } catch (readError) {
          replyError(readError, { warning: error?.message || String(error) });
        }
      }
    })();
    return true;
  }

  // Fetch Pages from Facebook API
  if (request.action === "fetchPages") {
    fetchFacebookPages(request.accessToken, request.cookie)
      .then(sendResponse)
      .catch((error) => replyError(error));
    return true;
  }

  // Fetch Ad Accounts from Facebook API
  if (request.action === "fetchAdAccounts") {
    fetchFacebookAdAccounts(request.accessToken, request.cookie)
      .then(sendResponse)
      .catch((error) => replyError(error));
    return true;
  }

  // Convert Lazada URL to affiliate link
  if (request.action === "convertLazadaLink") {
    convertToLazadaAffiliateLink(request.productUrl)
      .then(sendResponse)
      .catch((error) => replyError(error));
    return true;
  }

  // Check Lazada login status
  if (request.action === "checkLazadaLogin") {
    getLazadaCookies()
      .then(sendResponse)
      .catch((error) => replyError(error));
    return true;
  }

  // Schedule post via GraphQL (directly from background with cookies)
  if (request.action === "schedulePostGraphQL") {
    schedulePostViaGraphQL(
      request.postId,
      request.pageId,
      request.fbDtsg,
      request.scheduledTime
    )
      .then(sendResponse)
      .catch((error) => replyError(error));
    return true;
  }

  sendResponse({
    success: false,
    reason: "unknown_action",
    error: `Unknown action: ${String(request?.action || "")}`,
  });
  return false;

});

// Schedule post via GraphQL - use hidden Facebook window with content script
async function schedulePostViaGraphQL(postId, pageId, fbDtsg, scheduledTime) {
  console.log("[FEWFEED] schedulePostViaGraphQL called:", { postId, pageId, scheduledTime, fbDtsgPrefix: fbDtsg?.substring(0, 20) });

  if (!fbDtsg) {
    return { success: false, error: "fb_dtsg is required for scheduling. Please refresh Facebook login." };
  }

  // Convert post ID to story ID format
  // e.g. "168440993027073_122247104042156951" -> "S:_I168440993027073:122247104042156951"
  const parts = postId.split("_");
  if (parts.length !== 2) {
    return { success: false, error: `Invalid post ID format: ${postId}` };
  }
  const storyId = `S:_I${parts[0]}:${parts[1]}`;
  console.log("[FEWFEED] Story ID:", storyId);

  try {
    // Find existing Facebook tab
    const tabs = await chrome.tabs.query({});
    let fbTab = tabs.find(tab =>
      tab.url && (
        tab.url.includes("facebook.com") ||
        tab.url.includes("www.facebook.com") ||
        tab.url.includes("business.facebook.com")
      )
    );

    let bgWindowId = null;

    if (!fbTab) {
      // Create a minimized background Facebook window (invisible to user)
      console.log("[FEWFEED] No Facebook tab found, creating minimized background window...");
      const bgWindow = await chrome.windows.create({
        url: "https://business.facebook.com/latest/home",
        type: 'popup',
        state: 'minimized',
        focused: false
      });

      fbTab = bgWindow.tabs[0];
      bgWindowId = bgWindow.id;

      // Wait for page to load
      await new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
          if (tabId === fbTab.id && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 10000);
      });

      // Wait for content script to initialize
      await new Promise(r => setTimeout(r, 1500));
    }

    console.log("[FEWFEED] Using Facebook tab:", fbTab.id);

    // Try to send message, inject content script if needed
    let result;
    try {
      result = await chrome.tabs.sendMessage(fbTab.id, {
        action: "schedulePostGraphQL",
        storyId: storyId,
        pageId: pageId,
        fbDtsg: fbDtsg,
        scheduledTime: scheduledTime
      });
    } catch (msgError) {
      console.log("[FEWFEED] Message failed, injecting content script...", msgError.message);

      // Inject content script manually
      await chrome.scripting.executeScript({
        target: { tabId: fbTab.id },
        files: ["fb-content.js"]
      });

      // Wait for script to initialize
      await new Promise(r => setTimeout(r, 500));

      // Retry sending message
      result = await chrome.tabs.sendMessage(fbTab.id, {
        action: "schedulePostGraphQL",
        storyId: storyId,
        pageId: pageId,
        fbDtsg: fbDtsg,
        scheduledTime: scheduledTime
      });
    }

    // Clean up background window immediately after request completes
    if (bgWindowId) {
      chrome.windows.remove(bgWindowId).catch(() => { });
    }

    console.log("[FEWFEED] Schedule result:", result);
    return result || { success: false, error: "No response from content script" };
  } catch (error) {
    console.error("[FEWFEED] Error:", error);
    return { success: false, error: error.message };
  }
}

async function fetchAllFacebookPages(endpoint, headers) {
  const visited = new Set();
  const pages = [];
  let nextUrl = endpoint;
  let hops = 0;
  const maxHops = 20;

  while (nextUrl && hops < maxHops) {
    if (visited.has(nextUrl)) break;
    visited.add(nextUrl);
    hops += 1;

    const response = await fetch(nextUrl, { headers });
    const data = await response.json();
    if (data?.error) {
      return {
        success: false,
        error: data.error.message || "facebook_pages_error",
        code: Number(data.error.code || 0),
        subcode: Number(data.error.error_subcode || 0),
      };
    }

    if (Array.isArray(data?.data) && data.data.length > 0) {
      pages.push(...data.data);
    }

    const candidateNext = String(data?.paging?.next || "").trim();
    nextUrl = candidateNext || "";
  }

  return { success: true, pages };
}

function mergeFacebookPages(preferredPages = [], fallbackPages = []) {
  const map = new Map();
  const append = (page) => {
    const pageId = String(page?.id || "").trim();
    if (!pageId) return;

    const existing = map.get(pageId);
    if (!existing) {
      map.set(pageId, page);
      return;
    }

    const existingToken = String(existing?.access_token || "").trim();
    const incomingToken = String(page?.access_token || "").trim();
    map.set(pageId, {
      ...existing,
      ...page,
      access_token: incomingToken || existingToken,
      picture: page?.picture || existing?.picture,
    });
  };

  preferredPages.forEach(append);
  fallbackPages.forEach(append);
  return Array.from(map.values());
}

// Fetch Pages from Facebook Graph API with robust cookie + token fallback.
async function fetchFacebookPages(accessToken, cookie) {
  const normalizedToken = String(accessToken || "").trim();
  const normalizedCookie = String(cookie || "").trim();
  const hasAccessToken = !!normalizedToken;
  const hasCookie = !!normalizedCookie;

  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const tokenHeaders = { "User-Agent": userAgent };
  const cookieHeaders = hasCookie
    ? { ...tokenHeaders, Cookie: normalizedCookie }
    : tokenHeaders;

  const cookieEndpoint =
    "https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,picture,is_published&limit=100";
  const tokenEndpoint = hasAccessToken
    ? `https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(normalizedToken)}&fields=id,name,access_token,picture,is_published&limit=100`
    : "";

  try {
    let cookieResult = null;
    let tokenResult = null;

    // Cookie-authenticated call is more stable when access token was replaced by page-token fallback.
    if (hasCookie) {
      cookieResult = await fetchAllFacebookPages(cookieEndpoint, cookieHeaders);
    }
    if (hasAccessToken) {
      tokenResult = await fetchAllFacebookPages(tokenEndpoint, cookieHeaders);
    }

    if (cookieResult?.success && tokenResult?.success) {
      const mergedPages = mergeFacebookPages(cookieResult.pages || [], tokenResult.pages || []);
      return { success: true, pages: mergedPages };
    }
    if (cookieResult?.success) {
      return { success: true, pages: cookieResult.pages || [] };
    }
    if (tokenResult?.success) {
      return { success: true, pages: tokenResult.pages || [] };
    }

    const errors = [cookieResult?.error, tokenResult?.error].filter(Boolean);
    return {
      success: false,
      error: errors[0] || "ไม่สามารถดึงรายชื่อเพจได้",
    };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// Fetch Ad Accounts from Facebook Graph API with cookie fallback
async function fetchFacebookAdAccounts(accessToken, cookie) {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    if (cookie) {
      headers["Cookie"] = cookie;
    }

    const response = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?access_token=${accessToken}&fields=account_id,account_status,name`,
      { headers }
    );
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    return { success: true, adAccounts: data.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// LAZADA AFFILIATE LINK GENERATION (mtop API)
// ============================================

// Convert Lazada URL to affiliate link using mtop API (for s.lazada.co.th format)
function parseJsonMaybe(input) {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  if (!trimmed) return input;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return input;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return input;
  }
}

function normalizeAffiliateUrl(rawUrl) {
  let value = String(rawUrl || "").trim();
  if (!value) return "";

  value = value.replace(/\\\//g, "/");
  value = value.replace(/^["']|["']$/g, "");

  if (value.startsWith("\\/\\/")) value = value.slice(1);
  if (value.startsWith("//")) value = `https:${value}`;
  if (value.startsWith("/")) value = `https://www.lazada.co.th${value}`;
  if (!/^https?:\/\//i.test(value) && /(^|\.)lazada\.co\.th\//i.test(value)) {
    value = `https://${value.replace(/^\/+/, "")}`;
  }

  if (!/^https?:\/\//i.test(value)) return "";

  try {
    return new URL(value).toString();
  } catch (_) {
    return "";
  }
}

function collectAffiliateCandidates(source, output = [], seen = new Set(), depth = 0) {
  if (depth > 6 || source == null) return output;

  const pushUrl = (candidate) => {
    const normalized = normalizeAffiliateUrl(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  };

  if (typeof source === "string") {
    const parsed = parseJsonMaybe(source);
    if (parsed !== source) {
      collectAffiliateCandidates(parsed, output, seen, depth + 1);
    }

    const text = source.replace(/\\\//g, "/");
    const urlMatches = text.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
    urlMatches.forEach(pushUrl);

    const noSchemeMatches = text.match(/(?:^|[^\w])(s\.lazada\.co\.th\/[^\s"'<>\\]+|c\.lazada\.co\.th\/[^\s"'<>\\]+|(?:[\w-]+\.)?lazada\.co\.th\/[^\s"'<>\\]+)/gi) || [];
    noSchemeMatches.forEach((match) => {
      const cleaned = String(match).trim().replace(/^[^\w/]+/, "");
      pushUrl(cleaned);
    });
    return output;
  }

  if (Array.isArray(source)) {
    source.forEach((item) => collectAffiliateCandidates(item, output, seen, depth + 1));
    return output;
  }

  if (typeof source === "object") {
    Object.values(source).forEach((value) => collectAffiliateCandidates(value, output, seen, depth + 1));
  }

  return output;
}

function pickBestAffiliateUrl(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const priority = [
    (url) => url.includes("://s.lazada.co.th/"),
    (url) => url.includes("://c.lazada.co.th/"),
    (url) => url.includes("lazada.co.th/"),
  ];
  for (const rank of priority) {
    const match = candidates.find((url) => rank(url));
    if (match) return match;
  }
  return candidates[0] || "";
}

async function convertToLazadaAffiliateLink(productUrl) {
  console.log("[FEWFEED] Converting Lazada URL:", productUrl);

  // Get Lazada cookies first
  const cookies = await chrome.cookies.getAll({ domain: ".lazada.co.th" });
  if (cookies.length === 0) {
    return { success: false, error: "กรุณา login Lazada ในเบราว์เซอร์ก่อน" };
  }

  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");

  // Get _m_h5_tk token for mtop API signature
  const h5tkCookie = cookies.find(c => c.name === "_m_h5_tk");
  const h5tk = h5tkCookie?.value?.split("_")[0] || "";

  if (!h5tk) {
    console.log("[FEWFEED] No _m_h5_tk cookie - need to visit Lazada first");
    return { success: false, error: "กรุณาเปิด lazada.co.th ในเบราว์เซอร์ก่อน" };
  }

  try {
    // Prepare mtop API request (same params as Link Tool page)
    const timestamp = Date.now().toString();
    const api = "mtop.lazada.affiliate.lania.offer.getPromotionLinkFromJumpUrl";
    const v = "1.1";
    const appKey = "24677475";

    // Data payload
    const data = JSON.stringify({ jumpUrl: productUrl });

    // Generate mtop sign: md5(token + "&" + timestamp + "&" + appKey + "&" + data)
    const signStr = h5tk + "&" + timestamp + "&" + appKey + "&" + data;
    const sign = md5(signStr);

    // Build URL with all required params
    const params = new URLSearchParams({
      jsv: "2.6.1",
      appKey: appKey,
      t: timestamp,
      sign: sign,
      api: api,
      v: v,
      type: "originaljson",
      isSec: "1",
      AntiCreep: "true",
      timeout: "5000",
      needLogin: "true",
      dataType: "json",
      sessionOption: "AutoLoginOnly",
      "x-i18n-language": "th",
      "x-i18n-regionID": "TH",
      data: data
    });

    const url = `https://acs-m.lazada.co.th/h5/${api}/${v}/?${params.toString()}`;

    console.log("[FEWFEED] Calling mtop API for s.lazada link...");

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://pages.lazada.co.th/'
      },
      credentials: 'include'
    });

    const result = await response.json();
    console.log("[FEWFEED] mtop API response:", JSON.stringify(result));

    // Check for affiliate links in response - try multiple shapes
    const rawDataObj = parseJsonMaybe(result.data || {});
    const dataObj = (rawDataObj && typeof rawDataObj === "object") ? rawDataObj : {};

    // Try to find the short link (s.lazada format)
    const directLinkCandidates = [
      dataObj.shortLink,
      dataObj.short_link,
      dataObj.sLink,
      dataObj.promotionLink,
      dataObj.promotion_link,
      dataObj.link,
      dataObj.url,
      dataObj.result?.shortLink,
      dataObj.result?.promotionLink,
      dataObj.result?.link,
      dataObj.model?.shortLink,
      dataObj.model?.promotionLink,
      dataObj.model?.link,
      result.shortLink,
      result.promotionLink,
      result.link,
      result.url,
    ].map(normalizeAffiliateUrl).filter(Boolean);

    const directLink = pickBestAffiliateUrl(directLinkCandidates);
    if (directLink) {
      console.log("[FEWFEED] Found direct affiliate link:", directLink);
      return {
        success: true,
        affiliateLink: directLink,
        productName: dataObj.productName || dataObj.product_name || '',
        commissionRate: dataObj.commissionRate || dataObj.commission_rate || ''
      };
    }

    // Fallback: recursively scan entire response for any URL.
    const discoveredLinks = collectAffiliateCandidates({
      ...result,
      data: dataObj,
    });
    const discoveredAffiliateLink = pickBestAffiliateUrl(discoveredLinks);
    if (discoveredAffiliateLink) {
      console.log("[FEWFEED] Found affiliate link from deep scan:", discoveredAffiliateLink);
      return {
        success: true,
        affiliateLink: discoveredAffiliateLink,
        productName: dataObj.productName || dataObj.product_name || '',
        commissionRate: dataObj.commissionRate || dataObj.commission_rate || ''
      };
    }

    // Check ret array - might contain SUCCESS but link is elsewhere
    if (result.ret && result.ret.length > 0) {
      const retStr = result.ret.join(', ');
      console.log("[FEWFEED] ret:", retStr);

      // If SUCCESS, look harder for the link
      if (retStr.includes('SUCCESS')) {
        // Search entire result object for s.lazada URL
        const jsonStr = JSON.stringify(result);
        const sLinkMatch = jsonStr.match(/https?:\/\/s\.lazada\.co\.th\/s\.[A-Za-z0-9]+/);
        if (sLinkMatch) {
          console.log("[FEWFEED] Found s.lazada in response:", sLinkMatch[0]);
          return {
            success: true,
            affiliateLink: sLinkMatch[0],
            productName: dataObj.productName || ''
          };
        }

        // Search for any lazada tracking URL
        const cLinkMatch = jsonStr.match(/https?:\/\/c\.lazada\.co\.th\/[^\s"]+/);
        if (cLinkMatch) {
          console.log("[FEWFEED] Found c.lazada in response:", cLinkMatch[0]);
          return {
            success: true,
            affiliateLink: cLinkMatch[0],
            productName: dataObj.productName || ''
          };
        }
      }

      // Session error - need to re-login
      if (retStr.includes('SESSION_EXPIRED') || retStr.includes('FAIL_SYS_SESSION')) {
        return { success: false, error: "Session หมดอายุ กรุณา refresh หน้า Lazada แล้วลองใหม่" };
      }

      // Other error (show concise message, avoid dumping raw response)
      if (!retStr.includes('SUCCESS')) {
        return {
          success: false,
          error: `ระบบ Lazada ยังไม่คืนลิงก์ย่อ (${retStr.slice(0, 120)})`,
        };
      }
    }

    // Last resort - concise message (no raw JSON in UI)
    return {
      success: false,
      error: "Lazada ตอบกลับสำเร็จ แต่ยังไม่พบลิงก์ affiliate ที่ใช้งานได้ ลองเปิดหน้าสินค้า Lazada แล้วกดใหม่อีกครั้ง",
    };

  } catch (e) {
    console.error("[FEWFEED] mtop API error:", e);
    return { success: false, error: e.message };
  }
}

// MD5 implementation for mtop signature (WebCrypto doesn't support MD5)
function md5(string) {
  function rotateLeft(x, n) {
    return (x << n) | (x >>> (32 - n));
  }

  function addUnsigned(x, y) {
    const x8 = x & 0x80000000;
    const y8 = y & 0x80000000;
    const x4 = x & 0x40000000;
    const y4 = y & 0x40000000;
    const result = (x & 0x3FFFFFFF) + (y & 0x3FFFFFFF);
    if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
    if (x4 | y4) {
      if (result & 0x40000000) return result ^ 0xC0000000 ^ x8 ^ y8;
      return result ^ 0x40000000 ^ x8 ^ y8;
    }
    return result ^ x8 ^ y8;
  }

  function f(x, y, z) { return (x & y) | (~x & z); }
  function g(x, y, z) { return (x & z) | (y & ~z); }
  function h(x, y, z) { return x ^ y ^ z; }
  function i(x, y, z) { return y ^ (x | ~z); }

  function ff(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(f(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function gg(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(g(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function hh(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(h(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function ii(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(i(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }

  function convertToWordArray(str) {
    let wordCount;
    const msgLen = str.length;
    const temp1 = msgLen + 8;
    const temp2 = (temp1 - (temp1 % 64)) / 64;
    const numWords = (temp2 + 1) * 16;
    const wordArray = Array(numWords - 1);
    let bytePos = 0;
    let byteCount = 0;
    while (byteCount < msgLen) {
      wordCount = (byteCount - (byteCount % 4)) / 4;
      bytePos = (byteCount % 4) * 8;
      wordArray[wordCount] = wordArray[wordCount] | (str.charCodeAt(byteCount) << bytePos);
      byteCount++;
    }
    wordCount = (byteCount - (byteCount % 4)) / 4;
    bytePos = (byteCount % 4) * 8;
    wordArray[wordCount] = wordArray[wordCount] | (0x80 << bytePos);
    wordArray[numWords - 2] = msgLen << 3;
    wordArray[numWords - 1] = msgLen >>> 29;
    return wordArray;
  }

  function wordToHex(value) {
    let hex = "", temp, byte;
    for (let count = 0; count <= 3; count++) {
      byte = (value >>> (count * 8)) & 255;
      temp = "0" + byte.toString(16);
      hex += temp.substr(temp.length - 2, 2);
    }
    return hex;
  }

  const x = convertToWordArray(string);
  let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  for (let k = 0; k < x.length; k += 16) {
    const AA = a, BB = b, CC = c, DD = d;
    a = ff(a, b, c, d, x[k + 0], S11, 0xD76AA478);
    d = ff(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
    c = ff(c, d, a, b, x[k + 2], S13, 0x242070DB);
    b = ff(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
    a = ff(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
    d = ff(d, a, b, c, x[k + 5], S12, 0x4787C62A);
    c = ff(c, d, a, b, x[k + 6], S13, 0xA8304613);
    b = ff(b, c, d, a, x[k + 7], S14, 0xFD469501);
    a = ff(a, b, c, d, x[k + 8], S11, 0x698098D8);
    d = ff(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
    c = ff(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
    b = ff(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
    a = ff(a, b, c, d, x[k + 12], S11, 0x6B901122);
    d = ff(d, a, b, c, x[k + 13], S12, 0xFD987193);
    c = ff(c, d, a, b, x[k + 14], S13, 0xA679438E);
    b = ff(b, c, d, a, x[k + 15], S14, 0x49B40821);
    a = gg(a, b, c, d, x[k + 1], S21, 0xF61E2562);
    d = gg(d, a, b, c, x[k + 6], S22, 0xC040B340);
    c = gg(c, d, a, b, x[k + 11], S23, 0x265E5A51);
    b = gg(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
    a = gg(a, b, c, d, x[k + 5], S21, 0xD62F105D);
    d = gg(d, a, b, c, x[k + 10], S22, 0x2441453);
    c = gg(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
    b = gg(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
    a = gg(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
    d = gg(d, a, b, c, x[k + 14], S22, 0xC33707D6);
    c = gg(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
    b = gg(b, c, d, a, x[k + 8], S24, 0x455A14ED);
    a = gg(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
    d = gg(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
    c = gg(c, d, a, b, x[k + 7], S23, 0x676F02D9);
    b = gg(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
    a = hh(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
    d = hh(d, a, b, c, x[k + 8], S32, 0x8771F681);
    c = hh(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
    b = hh(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
    a = hh(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
    d = hh(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
    c = hh(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
    b = hh(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
    a = hh(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
    d = hh(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
    c = hh(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
    b = hh(b, c, d, a, x[k + 6], S34, 0x4881D05);
    a = hh(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
    d = hh(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
    c = hh(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
    b = hh(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
    a = ii(a, b, c, d, x[k + 0], S41, 0xF4292244);
    d = ii(d, a, b, c, x[k + 7], S42, 0x432AFF97);
    c = ii(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
    b = ii(b, c, d, a, x[k + 5], S44, 0xFC93A039);
    a = ii(a, b, c, d, x[k + 12], S41, 0x655B59C3);
    d = ii(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
    c = ii(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
    b = ii(b, c, d, a, x[k + 1], S44, 0x85845DD1);
    a = ii(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
    d = ii(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
    c = ii(c, d, a, b, x[k + 6], S43, 0xA3014314);
    b = ii(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
    a = ii(a, b, c, d, x[k + 4], S41, 0xF7537E82);
    d = ii(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
    c = ii(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
    b = ii(b, c, d, a, x[k + 9], S44, 0xEB86D391);
    a = addUnsigned(a, AA);
    b = addUnsigned(b, BB);
    c = addUnsigned(c, CC);
    d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

// Note: Open Platform API removed - using only mtop API for s.lazada links

// Get Lazada cookies (for future use if needed)
async function getLazadaCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: ".lazada.co.th" });
    if (cookies.length === 0) {
      return { success: false, error: "Not logged in to Lazada" };
    }
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    return { success: true, cookies: cookieString };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// END LAZADA SECTION
// ============================================

console.log("[Pubilo] Background v9.1.6 loaded - supports facebook.com root domain + resilient extraction");
