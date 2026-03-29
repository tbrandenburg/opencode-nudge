.PHONY: install test test-e2e typecheck lint

PLUGIN_DIR := auto-continue-plugin

install:
	cd $(PLUGIN_DIR) && bun install
	git config core.hooksPath hooks
	chmod +x hooks/pre-push

typecheck:
	cd $(PLUGIN_DIR) && bunx tsc --noEmit

test:
	cd $(PLUGIN_DIR) && bun test src/throttle.test.ts src/idle-handler.test.ts

test-e2e:
	cd $(PLUGIN_DIR) && bun test src/e2e.test.ts

lint: typecheck
