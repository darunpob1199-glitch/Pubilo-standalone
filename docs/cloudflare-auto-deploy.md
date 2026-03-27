# Cloudflare Auto Deploy

This repository is prepared for GitHub Actions based deployments to the Cloudflare account:

- Account ID: `53987ff7a0defba5fae5e72d3feb57ca`

## Branch mapping

- `main` -> production
- `dev` -> development

## Workflows

- `.github/workflows/deploy-api.yml`
- `.github/workflows/deploy-web.yml`
- `.github/workflows/deploy-miniapp.yml`

## Required GitHub secret

Add this repository secret in GitHub:

- `CLOUDFLARE_API_TOKEN`

Create the token from the Cloudflare dashboard with at least the scopes needed to deploy Workers, D1, and Pages for this account.

## Existing Cloudflare targets

- API prod: `pubilo-api-prod`
- API dev: `pubilo-api-dev`
- Pages prod: `pubilo-web-prod`
- Pages dev: `pubilo-web-dev`
- Miniapp prod: `pubilo-miniapp-prod`
- Miniapp dev: `pubilo-miniapp-dev`

## Notes

- The Chrome extension still needs to be reloaded manually after local changes.
- The OG worker is not part of auto deploy yet because the Rust build is currently broken in CI and on this machine.
