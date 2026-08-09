.DEFAULT_GOAL := help

DEV_PORT  ?= 5173
PROD_PORT ?= 4173

.PHONY: help install build dev prod test test-unit test-e2e test-e2e-prod test-all clean

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Ports: DEV_PORT=$(DEV_PORT) PROD_PORT=$(PROD_PORT) (override on the command line)"

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

install: node_modules ## Install dependencies

build: node_modules ## Typecheck and build to dist/
	npm run build

dev: node_modules ## Run the dev server with hot reload
	npm run dev -- --port $(DEV_PORT)

prod: build ## Build, then serve the production bundle
	npm run preview -- --port $(PROD_PORT)

test: test-unit ## Alias for test-unit

test-unit: node_modules ## Run the Vitest unit suite
	npm test

test-e2e: node_modules ## Run Playwright against the dev server
	npx playwright test

test-e2e-prod: node_modules ## Run Playwright against the production build
	E2E_PREVIEW=1 npx playwright test

test-all: test-unit test-e2e test-e2e-prod ## Run every suite

clean: ## Remove build output and test artifacts
	rm -rf dist test-results playwright-report
