#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(relPath) {
  return readFileSync(join(root, relPath), 'utf8')
}

function mustInclude(content, needle, filePath, label, errors) {
  if (!content.includes(needle)) {
    errors.push(`${filePath}: missing ${label}`)
  }
}

const errors = []

const webConfigPath = 'apps/web/js/config.js'
const webIndexPath = 'apps/web/index.html'
const webPublishPath = 'apps/web/js/parts/12-publish.js'
const webNewsPublishPath = 'apps/web/js/parts/11-image-generation.js'
const webWorkerPath = 'apps/web/_worker.js'
const apiPublishPath = 'apps/api/src/routes/publish.ts'
const apiNewsLinkPath = 'apps/api/src/routes/news-link.ts'
const apiAuthPath = 'apps/api/src/routes/auth.ts'
const apiFacebookAuthPath = 'apps/api/src/auth/facebook.ts'
const extensionBackgroundPath = 'apps/extension/background.js'
const extensionContentPath = 'apps/extension/content.js'

const webConfig = read(webConfigPath)
const webIndex = read(webIndexPath)
const webPublish = read(webPublishPath)
const webNewsPublish = read(webNewsPublishPath)
const webWorker = read(webWorkerPath)
const apiPublish = read(apiPublishPath)
const apiNewsLink = read(apiNewsLinkPath)
const apiAuth = read(apiAuthPath)
const apiFacebookAuth = read(apiFacebookAuthPath)
const extensionBackground = read(extensionBackgroundPath)
const extensionContent = read(extensionContentPath)

mustInclude(webConfig, "const allowApiParamOverride = !isProductionWebHost;", webConfigPath, 'production api override guard', errors)
mustInclude(webConfig, "hostname === 'pubilo.com'", webConfigPath, 'pubilo.com production host check', errors)
mustInclude(webConfig, "hostname === 'pubilo-web-prod.pages.dev'", webConfigPath, 'pages production host check', errors)
mustInclude(webConfig, "'127.0.0.1': 'http://127.0.0.1:8787'", webConfigPath, 'local dev api base mapping', errors)
mustInclude(webConfig, 'if (apiParam && allowApiParamOverride)', webConfigPath, 'api override allow condition', errors)
mustInclude(webConfig, 'Ignored ?api override on production host', webConfigPath, 'api override warning branch', errors)

mustInclude(webPublish, 'allowAdCreativePublish: true', webPublishPath, 'client-side ad creative opt-in for card links', errors)
mustInclude(webPublish, 'targetPageIds: targetPageIdsAtClick,', webPublishPath, 'publish snapshot includes multi-page targets', errors)
mustInclude(webPublish, 'function handleMultiPageItemSelection', webPublishPath, 'multi-page picker row toggle handler', errors)
mustInclude(webPublish, 'clearPrimaryPageSelection({ keepPickerOpen: true });', webPublishPath, 'selected primary can be deselected from picker', errors)
mustInclude(webPublish, 'multiPageList.dataset.routePickerBound = "true";', webPublishPath, 'multi-page picker delegated click handler', errors)
mustInclude(webPublish, 'const pagePickerClearBtn = document.getElementById("pagePickerClearBtn");', webPublishPath, 'multi-page picker clear button binding', errors)
mustInclude(webPublish, 'toggleTargetPage(normalizedPageId);', webPublishPath, 'multi-page picker toggles target pages', errors)
mustInclude(webIndex, 'id="pagePickerClearBtn"', webIndexPath, 'page picker clear button markup', errors)
mustInclude(webIndex, '/js/parts/12-publish.js?v=11.36', webIndexPath, 'publish script cache-busted version', errors)
mustInclude(webPublish, 'const FACEBOOK_API_ONLY_PUBLISH = true;', webPublishPath, 'official Facebook API-only publish default', errors)
mustInclude(webPublish, 'facebookApiOnly: FACEBOOK_API_ONLY_PUBLISH', webPublishPath, 'publish payload prefers official Facebook API', errors)
mustInclude(webPublish, 'skipExtension: FACEBOOK_API_ONLY_PUBLISH', webPublishPath, 'publish token hydration skips extension in API-only mode', errors)
mustInclude(webIndex, '/js/parts/11-image-generation.js?v=9.20', webIndexPath, 'news publish script cache-busted version', errors)
mustInclude(webIndex, '/css/styles.css?v=8.6', webIndexPath, 'styles cache-busted version', errors)
mustInclude(webIndex, '/css/parts/modern-ui.css?v=1.6', webIndexPath, 'modern ui cache-busted version', errors)
mustInclude(webIndex, 'id="connectFacebookApiBtn"', webIndexPath, 'official Facebook API connect button markup', errors)
mustInclude(webIndex, 'id="refreshFacebookApiPagesBtn"', webIndexPath, 'official Facebook API refresh button markup', errors)
mustInclude(webPublish, 'function getFacebookApiLoginUrl', webPublishPath, 'official Facebook API login URL builder', errors)
mustInclude(webPublish, 'function handleFacebookAuthRedirectResult', webPublishPath, 'official Facebook API callback result handler', errors)
mustInclude(webPublish, 'params.get("facebook_auth") === "connected"', webPublishPath, 'official Facebook API connected redirect handling', errors)
mustInclude(webPublish, 'refreshFacebookApiStatus({ silent: true })', webPublishPath, 'official Facebook API status refresh in modal', errors)

mustInclude(webWorker, 'function rewriteLocalHtmlAssetVersions', webWorkerPath, 'local dev html asset cache busting', errors)
mustInclude(webWorker, 'parsed.searchParams.set("dev", devVersion);', webWorkerPath, 'local dev asset version query', errors)
mustInclude(webWorker, 'isLocalDevHost(url.hostname) && contentType.includes("text/html")', webWorkerPath, 'local dev html rewrite gate', errors)
mustInclude(webWorker, 'withNoStoreHeaders(assetResponse.headers)', webWorkerPath, 'worker-level no-store headers for static assets', errors)

mustInclude(
  apiPublish,
  'const rawClientAdCreativeFlag = body.allowAdCreativePublish ?? body.useAdCreativeFlow ?? body.enableAdCreativePublish;',
  apiPublishPath,
  'ad creative client flag resolver',
  errors,
)
mustInclude(
  apiPublish,
  'const useFacebookApiOnly = parseBooleanFlag(facebookApiOnly)',
  apiPublishPath,
  'server honors official Facebook API-only publish flag',
  errors,
)
mustInclude(
  apiPublish,
  'const adCreativeFlowEnabled = adCreativeAllowedByEnv && adCreativeRequestedByClient && !forceSafePhotoFallback;',
  apiPublishPath,
  'ad creative dual gate with force-photo bypass',
  errors,
)
mustInclude(
  apiPublish,
  'linkUrl: shouldUseControlledPreviewForLinkCard ? publishLinkUrl : finalLink,',
  apiPublishPath,
  'ad creative uses controlled preview link for rich card mode',
  errors,
)
mustInclude(
  apiPublish,
  'allowAdMaterialization: !scheduleTimestamp,',
  apiPublishPath,
  'ad materialization immediate-only gate',
  errors,
)
mustInclude(
  apiPublish,
  'const allowFeedMetadataOverrides = false;',
  apiPublishPath,
  'feed metadata override hard-disable',
  errors,
)
mustInclude(
  apiPublish,
  'function isLinkMetadataOwnershipErrorMessage',
  apiPublishPath,
  'metadata ownership error classifier',
  errors,
)
mustInclude(
  apiPublish,
  'async function publishTextOnlyWithToken',
  apiPublishPath,
  'server text-only fallback after rejected link cards',
  errors,
)
mustInclude(
  apiPublish,
  "flow: 'text-only-fallback-after-link-failure'",
  apiPublishPath,
  'server records text-only fallback flow',
  errors,
)
mustInclude(
  apiPublish,
  'richLinkImageUnavailable',
  apiPublishPath,
  'server skips rich-card attempts when local image hosting is unavailable',
  errors,
)
mustInclude(
  apiPublish,
  'const forceSafePhotoFallback =',
  apiPublishPath,
  'server force-photo fallback flag resolver',
  errors,
)
mustInclude(
  apiPublish,
  'if (!forceSafePhotoFallback) {',
  apiPublishPath,
  'server skips link-card feed attempts when force-photo fallback is requested',
  errors,
)
mustInclude(
  apiPublish,
  'function getPublicNewsPreviewOrigin',
  apiPublishPath,
  'server uses public news preview origin for local publish tests',
  errors,
)
mustInclude(
  apiPublish,
  'const allowAdCreativeMetadataOverrides = false;',
  apiPublishPath,
  'server ad creative metadata override hard-disable',
  errors,
)
mustInclude(
  apiPublish,
  "errorType: 'SquareLinkCardUnavailable'",
  apiPublishPath,
  'server fails instead of silently posting photo when card link is required',
  errors,
)
mustInclude(
  apiPublish,
  "const previewSiteName = deriveSiteName('', finalLink);",
  apiPublishPath,
  'server preview site label follows target URL instead of caption',
  errors,
)
mustInclude(
  apiNewsLink,
  '<meta property="og:url" content="${target}" />',
  apiNewsLinkPath,
  'news preview canonical OG URL uses Lazada target URL',
  errors,
)
mustInclude(
  apiNewsLink,
  '<link rel="canonical" href="${target}" />',
  apiNewsLinkPath,
  'news preview canonical link uses Lazada target URL',
  errors,
)
mustInclude(apiAuth, "app.get('/login/facebook'", apiAuthPath, 'official Facebook API login route', errors)
mustInclude(apiAuth, "app.get('/facebook/callback'", apiAuthPath, 'official Facebook API callback route', errors)
mustInclude(apiAuth, "app.get('/facebook/status'", apiAuthPath, 'official Facebook API status route', errors)
mustInclude(apiAuth, 'post_token_encrypted = COALESCE(excluded.post_token_encrypted, page_settings.post_token_encrypted)', apiAuthPath, 'official Facebook API syncs page tokens', errors)
mustInclude(apiAuth, "facebook_auth: 'connected'", apiAuthPath, 'official Facebook API success redirect marker', errors)
mustInclude(apiFacebookAuth, "'pages_show_list'", apiFacebookAuthPath, 'official Facebook API page list permission', errors)
mustInclude(apiFacebookAuth, "'pages_read_engagement'", apiFacebookAuthPath, 'official Facebook API page read permission', errors)
mustInclude(apiFacebookAuth, "'pages_manage_posts'", apiFacebookAuthPath, 'official Facebook API publish permission', errors)
mustInclude(apiFacebookAuth, '/me/accounts', apiFacebookAuthPath, 'official Facebook API page account fetch', errors)
mustInclude(
  webNewsPublish,
  'payload.forcePhotoFallback = false;',
  webNewsPublishPath,
  'news extension direct fallback keeps link-card mode after link-card failures',
  errors,
)
mustInclude(
  webNewsPublish,
  'shouldRetryApiAsCleanLinkCard',
  webNewsPublishPath,
  'news publish retries API as clean link-card before extension fallback',
  errors,
)
mustInclude(
  webNewsPublish,
  'directFallbackMode: "link-card"',
  webNewsPublishPath,
  'news API retry can force clean link-card mode',
  errors,
)
mustInclude(
  webNewsPublish,
  'isNewsLinkCardMetadataFailure(data)',
  webNewsPublishPath,
  'news extension fallback detects metadata ownership errors from API text',
  errors,
)
mustInclude(
  webNewsPublish,
  'payload.previewLinkUrl = previewLinkUrl;',
  webNewsPublishPath,
  'news extension direct fallback keeps controlled preview URL for card output',
  errors,
)
mustInclude(
  webNewsPublish,
  'return "https://pubilo.com";',
  webNewsPublishPath,
  'news extension direct fallback avoids localhost preview URLs',
  errors,
)
mustInclude(
  webNewsPublish,
  'payload.callToAction = "";',
  webNewsPublishPath,
  'news extension direct fallback strips CTA for legacy extensions',
  errors,
)
mustInclude(
  webNewsPublish,
  'shouldRetryNewsExtensionDirectAsSafeFallback(directResult)',
  webNewsPublishPath,
  'news extension direct fallback retries with clean card payload if needed',
  errors,
)
mustInclude(
  webNewsPublish,
  'isExtensionDirectFallbackWrongFormat(directResult, retryPayload)',
  webNewsPublishPath,
  'news extension direct fallback rejects photo/text output when card is required',
  errors,
)
mustInclude(
  webNewsPublish,
  'NEWS_DIRECT_MIN_EXTENSION_VERSION = "9.2.19"',
  webNewsPublishPath,
  'news extension direct fallback requires updated extension version',
  errors,
)
mustInclude(
  webNewsPublish,
  'function deriveNewsPreviewSiteNameFromUrl',
  webNewsPublishPath,
  'news extension fallback derives preview site label from target URL',
  errors,
)
if (webNewsPublish.includes('payload.primaryText = [originalPrimaryText, originalLinkUrl]')) {
  errors.push(`${webNewsPublishPath}: raw Lazada link must not be auto-appended to primary text`)
}
mustInclude(
  extensionBackground,
  'directFallbackMode === "photo-text"',
  extensionBackgroundPath,
  'extension photo-only fallback mode flag',
  errors,
)
mustInclude(
  extensionBackground,
  'requireSquareLinkCard && !forcePhotoFallback',
  extensionBackgroundPath,
  'extension fails instead of posting photo/text when card link is required',
  errors,
)
mustInclude(
  extensionBackground,
  'errorType: "SquareLinkCardUnavailable"',
  extensionBackgroundPath,
  'extension reports card-link required failure',
  errors,
)
mustInclude(
  extensionBackground,
  '"http://127.0.0.1:4173/*"',
  extensionBackgroundPath,
  'extension injects into local pages dev host',
  errors,
)
mustInclude(
  extensionBackground,
  'const allowFeedMetadataOverrides = false;',
  extensionBackgroundPath,
  'extension feed metadata override hard-disable',
  errors,
)
mustInclude(
  extensionBackground,
  'const allowAdCreativeMetadataOverrides = false;',
  extensionBackgroundPath,
  'extension ad creative metadata override hard-disable',
  errors,
)
mustInclude(
  extensionBackground,
  'let skipRemainingLinkCardAttempts = false;',
  extensionBackgroundPath,
  'extension skips repeated link-card attempts after metadata ownership errors',
  errors,
)
mustInclude(
  extensionBackground,
  'const tryTextOnly = async (token, messageValue, withCookieHeader) => {',
  extensionBackgroundPath,
  'extension text-only fallback after rejected link cards',
  errors,
)
mustInclude(
  extensionBackground,
  'browser-side-text-only',
  extensionBackgroundPath,
  'extension reports text-only fallback strategy',
  errors,
)
mustInclude(
  extensionContent,
  'forcePhotoFallback: event.data.forcePhotoFallback,',
  extensionContentPath,
  'extension content forwards photo fallback flag',
  errors,
)
mustInclude(
  extensionContent,
  'directFallbackMode: event.data.directFallbackMode,',
  extensionContentPath,
  'extension content forwards safe fallback mode',
  errors,
)
mustInclude(
  extensionContent,
  'publishNewsDirectForcePhotoFallback: true',
  extensionContentPath,
  'extension content advertises force-photo fallback support',
  errors,
)
mustInclude(
  extensionContent,
  'publishNewsDirectCleanLinkCard: true',
  extensionContentPath,
  'extension content advertises clean card-link support',
  errors,
)

if (errors.length) {
  console.error('[smoke-release-guards] FAILED')
  errors.forEach((line) => console.error(`- ${line}`))
  process.exit(1)
}

console.log('[smoke-release-guards] OK')
