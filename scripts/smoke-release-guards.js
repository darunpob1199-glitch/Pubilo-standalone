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
const apiPublishPath = 'apps/api/src/routes/publish.ts'

const webConfig = read(webConfigPath)
const webPublish = read(webPublishPath)
const apiPublish = read(apiPublishPath)

mustInclude(webConfig, "const allowApiParamOverride = !isProductionWebHost;", webConfigPath, 'production api override guard', errors)
mustInclude(webConfig, "hostname === 'pubilo.com'", webConfigPath, 'pubilo.com production host check', errors)
mustInclude(webConfig, "hostname === 'pubilo-web-prod.pages.dev'", webConfigPath, 'pages production host check', errors)
mustInclude(webConfig, 'if (apiParam && allowApiParamOverride)', webConfigPath, 'api override allow condition', errors)
mustInclude(webConfig, 'Ignored ?api override on production host', webConfigPath, 'api override warning branch', errors)

mustInclude(webPublish, 'allowAdCreativePublish: false', webPublishPath, 'client-side ad creative opt-out default', errors)

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
mustInclude(apiPublish, 'linkUrl: finalLink,', apiPublishPath, 'ad creative uses final outbound link', errors)
mustInclude(apiPublish, 'allowAdMaterialization: false,', apiPublishPath, 'ad materialization disabled', errors)

if (errors.length) {
  console.error('[smoke-release-guards] FAILED')
  errors.forEach((line) => console.error(`- ${line}`))
  process.exit(1)
}

console.log('[smoke-release-guards] OK')
