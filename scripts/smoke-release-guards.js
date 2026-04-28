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
const extensionBackgroundPath = 'apps/extension/background.js'
const extensionContentPath = 'apps/extension/content.js'

const webConfig = read(webConfigPath)
const webIndex = read(webIndexPath)
const webPublish = read(webPublishPath)
const webNewsPublish = read(webNewsPublishPath)
const webWorker = read(webWorkerPath)
const apiPublish = read(apiPublishPath)
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
mustInclude(webPublish, 'toggleTargetPage(normalizedPageId);', webPublishPath, 'multi-page picker toggles target pages', errors)
mustInclude(webIndex, '/js/parts/12-publish.js?v=11.32', webIndexPath, 'publish script cache-busted version', errors)

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
  'const adCreativeFlowEnabled = adCreativeAllowedByEnv && adCreativeRequestedByClient;',
  apiPublishPath,
  'ad creative dual gate',
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
  webNewsPublish,
  'payload.forcePhotoFallback = true;',
  webNewsPublishPath,
  'news extension direct fallback uses photo-only after link-card failures',
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
  'buildNewsExtensionSafePreviewUrl(payload, hostedImageUrl)',
  webNewsPublishPath,
  'news extension direct fallback builds controlled preview for legacy extensions',
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
  'shouldRetryNewsExtensionDirectAsSafeFallback(directResult)',
  webNewsPublishPath,
  'news extension direct fallback retries safely if extension still hits link-card',
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
  extensionBackground,
  'directFallbackMode === "photo-text"',
  extensionBackgroundPath,
  'extension photo-only fallback mode flag',
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

if (errors.length) {
  console.error('[smoke-release-guards] FAILED')
  errors.forEach((line) => console.error(`- ${line}`))
  process.exit(1)
}

console.log('[smoke-release-guards] OK')
