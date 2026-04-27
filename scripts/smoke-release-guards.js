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
const webPublishPath = 'apps/web/js/parts/12-publish.js'
const webNewsPublishPath = 'apps/web/js/parts/11-image-generation.js'
const apiPublishPath = 'apps/api/src/routes/publish.ts'
const extensionBackgroundPath = 'apps/extension/background.js'
const extensionContentPath = 'apps/extension/content.js'

const webConfig = read(webConfigPath)
const webPublish = read(webPublishPath)
const webNewsPublish = read(webNewsPublishPath)
const apiPublish = read(apiPublishPath)
const extensionBackground = read(extensionBackgroundPath)
const extensionContent = read(extensionContentPath)

mustInclude(webConfig, "const allowApiParamOverride = !isProductionWebHost;", webConfigPath, 'production api override guard', errors)
mustInclude(webConfig, "hostname === 'pubilo.com'", webConfigPath, 'pubilo.com production host check', errors)
mustInclude(webConfig, "hostname === 'pubilo-web-prod.pages.dev'", webConfigPath, 'pages production host check', errors)
mustInclude(webConfig, 'if (apiParam && allowApiParamOverride)', webConfigPath, 'api override allow condition', errors)
mustInclude(webConfig, 'Ignored ?api override on production host', webConfigPath, 'api override warning branch', errors)

mustInclude(webPublish, 'allowAdCreativePublish: true', webPublishPath, 'client-side ad creative opt-in for card links', errors)

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
  webNewsPublish,
  'directPayload.forcePhotoFallback = true;',
  webNewsPublishPath,
  'news extension direct fallback uses photo-only after exhausted API fallbacks',
  errors,
)
mustInclude(
  webNewsPublish,
  'buildNewsExtensionSafePreviewUrl(directPayload, hostedImageUrl)',
  webNewsPublishPath,
  'news extension direct fallback builds controlled preview for legacy extensions',
  errors,
)
mustInclude(
  webNewsPublish,
  'directPayload.callToAction = "";',
  webNewsPublishPath,
  'news extension direct fallback strips CTA for legacy extensions',
  errors,
)
mustInclude(
  extensionBackground,
  'const forcePhotoFallback = request.forcePhotoFallback === true;',
  extensionBackgroundPath,
  'extension photo-only fallback flag',
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
  extensionContent,
  'forcePhotoFallback: event.data.forcePhotoFallback,',
  extensionContentPath,
  'extension content forwards photo fallback flag',
  errors,
)

if (errors.length) {
  console.error('[smoke-release-guards] FAILED')
  errors.forEach((line) => console.error(`- ${line}`))
  process.exit(1)
}

console.log('[smoke-release-guards] OK')
