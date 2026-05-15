.PHONY: help lint lint-actions install-hooks diagrams diagrams-check

DIAGRAM_SRC := $(wildcard docs/diagrams/*.mmd)
DIAGRAM_OUT := $(patsubst docs/diagrams/%.mmd,docs/diagrams/rendered/%.png,$(DIAGRAM_SRC))

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

lint: lint-actions diagrams-check ## Run all linters and freshness checks

lint-actions: ## Lint GitHub Actions workflows with actionlint
	@command -v actionlint >/dev/null 2>&1 || { echo "actionlint not installed. Run: brew install actionlint"; exit 1; }
	actionlint .github/workflows/*.yml

install-hooks: ## Install pre-commit git hooks
	@command -v pre-commit >/dev/null 2>&1 || { echo "pre-commit not installed. Run: brew install pre-commit"; exit 1; }
	pre-commit install
	@echo "Hooks installed. They run automatically on git commit."

diagrams: $(DIAGRAM_OUT) ## Render all .mmd diagrams to PNG

docs/diagrams/rendered/%.png: docs/diagrams/%.mmd
	@command -v mmdc >/dev/null 2>&1 || { echo "mmdc not installed. Run: brew install mermaid-cli"; exit 1; }
	@mkdir -p docs/diagrams/rendered
	mmdc -i "$<" -o "$@" -b transparent -w 1400

diagrams-check: diagrams ## Fail if rendered PNGs are stale vs source
	@if [ -n "$$(git status --porcelain docs/diagrams/rendered/)" ]; then \
	  echo "ERROR: Rendered diagrams are stale. Run 'make diagrams' and commit."; \
	  git status --short docs/diagrams/rendered/; \
	  exit 1; \
	fi
