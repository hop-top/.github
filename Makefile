.PHONY: help lint install-hooks

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

lint: ## Run all linters
	@command -v actionlint >/dev/null 2>&1 || { echo "actionlint not installed. Run: brew install actionlint"; exit 1; }
	actionlint .github/workflows/*.yml

install-hooks: ## Install pre-commit git hooks
	@command -v pre-commit >/dev/null 2>&1 || { echo "pre-commit not installed. Run: brew install pre-commit"; exit 1; }
	pre-commit install
	@echo "Hooks installed. They run automatically on git commit."
