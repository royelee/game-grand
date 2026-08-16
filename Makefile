.DEFAULT_GOAL := help

DEV_PORT  ?= 5173
PROD_PORT ?= 4173

CATALOG := public/library/scratch-catalog.json

.PHONY: help install catalog build dev prod test test-unit test-e2e test-e2e-prod test-e2e-server test-e2e-worker test-all clean server server-dev worker-dev deploy desktop-icon desktop-build desktop-dev

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Ports: DEV_PORT=$(DEV_PORT) PROD_PORT=$(PROD_PORT) (override on the command line)"

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

install: node_modules ## Install dependencies

# Generated, never committed. It is derived from scratch-gui's library JSONs,
# which are AGPL-3.0, so keeping it out of the repo keeps this project's own
# license unentangled — see public/library/LICENSE.md. Needs network. Its only
# prerequisite is the generator, so bumping SCRATCH_GUI_SHA re-downloads it.
# Missing is survivable: the library dialog says the Scratch tab is
# unavailable and the ten built-in assets still work.
$(CATALOG): scripts/build-scratch-catalog.ts | node_modules
	node scripts/build-scratch-catalog.ts

catalog: $(CATALOG) ## Download the Scratch library catalog (needs network)

build: node_modules $(CATALOG) ## Typecheck and build to dist/
	npm run build

# Save/Load need the Fastify server too — vite.config.ts proxies /api to
# http://localhost:8080, so run `make server-dev` in another shell (after at
# least one `make build`) alongside this target.
dev: node_modules $(CATALOG) ## Run the dev server with hot reload (Save/Load need `make server-dev` too)
	npm run dev -- --port $(DEV_PORT)

# Also proxies /api to http://localhost:8080 (see vite.config.ts) — pair with
# `make server-dev` if you want Save/Load to work here. For an actual
# single-process production server, use `make server` instead.
prod: build ## Build, then serve the production bundle
	npm run preview -- --host --port $(PROD_PORT)

test: test-unit ## Alias for test-unit

test-unit: node_modules ## Run the Vitest unit suite
	npm test

# The e2e suite drives the real library dialog, so it needs the catalog;
# test-unit deliberately does not (it builds from inline fixtures), which
# keeps the fast suite runnable with no network.
test-e2e: node_modules $(CATALOG) ## Run Playwright against the dev server
	npx playwright test

test-e2e-prod: node_modules $(CATALOG) ## Run Playwright against the production build
	E2E_PREVIEW=1 npx playwright test

test-e2e-server: node_modules $(CATALOG) ## Run Playwright against the real Fastify server
	E2E_SERVER=1 npx playwright test

# The only mode covering D1, the _headers rules and the /p/<id> fallback.
# `--local` means no Cloudflare account is needed.
test-e2e-worker: node_modules $(CATALOG) ## Run Playwright against the local Cloudflare Worker
	E2E_WORKER=1 npx playwright test

test-all: test-unit test-e2e test-e2e-prod test-e2e-server test-e2e-worker ## Run every suite

server: build ## Build the client, then run the server on PORT (default 8080)
	npm run server

server-dev: node_modules ## Run the server with reload (client must be built)
	npm run server:dev

# `--local` runs a real Worker against a local D1 file, so this needs no
# Cloudflare account and no database_id in wrangler.jsonc. It is the only way
# to exercise the _headers rules and the /p/<id> fallback before deploying.
worker-dev: build ## Run the Cloudflare Worker locally against a local D1
	npx wrangler d1 migrations apply game-grand --local
	npm run worker:dev

deploy: ## Deploy to Cloudflare (needs .env with CLOUDFLARE_API_TOKEN)
	./scripts/deploy.sh

# Generated, never committed — public/favicon.svg is the single source. Needs
# Playwright's chromium (`npx playwright install chromium`); sips and iconutil
# ship with macOS.
desktop/icon.icns: public/favicon.svg scripts/build-desktop-icon.ts | node_modules
	node scripts/build-desktop-icon.ts

desktop-icon: desktop/icon.icns ## Generate the Mac app icon from public/favicon.svg

desktop-build: node_modules desktop/icon.icns ## Compile the Electron main process to desktop/dist/
	npm run desktop:build

# Points at the deployed Worker by default. Override to develop against a
# local server: GAME_GRAND_URL=http://localhost:$(DEV_PORT) make desktop-dev
desktop-dev: desktop-build ## Run the Mac app shell
	npm run desktop

clean: ## Remove build output and test artifacts
	rm -rf dist test-results playwright-report desktop/dist desktop/icon.icns desktop/icon.iconset
