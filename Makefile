PYTHON ?= python3
RPT := scripts/release-please-target
NPM_CI := npm ci --ignore-scripts --no-audit --no-fund

.PHONY: help lint test-scripts test-workflows test-release-please-target mutate-release-please-target install-hooks

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

lint: ## Run all linters
	@command -v actionlint >/dev/null 2>&1 || { echo "actionlint not installed. Run: brew install actionlint"; exit 1; }
	actionlint .github/workflows/*.yml

test-scripts: ## Run the unit tests for scripts/spec
	$(PYTHON) -m unittest discover -s scripts/spec/tests -v

test-workflows: ## Run the tests for the workflows' inline check scripts
	$(PYTHON) -m unittest discover -s tests/workflows -v

test-release-please-target: ## Run the tests for scripts/release-please-target (rules, contract, simulation, runner)
	cd $(RPT) && $(NPM_CI) && npm test

mutate-release-please-target: ## Mutation check: each reintroduced defect must turn the release-please-target tests red
	cd $(RPT) && $(NPM_CI) && npm run mutate

install-hooks: ## Install pre-commit git hooks
	@command -v pre-commit >/dev/null 2>&1 || { echo "pre-commit not installed. Run: brew install pre-commit"; exit 1; }
	pre-commit install
	@echo "Hooks installed. They run automatically on git commit."
