SHELL := /bin/bash

all: clean build test

lint:
	@echo "cli-config has no lint. Ignoring."

build: install

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/
	cp -f package.json.orig package.json

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm install --no-frozen-lockfile

test:
	@echo ""
	@echo ">>>> cli-config"
	@rm -rf output
	cp -f .filedist.yml.orig .filedist.yml

	# --- Test 1: config from .filedist.yml ---
	# extract entries from .filedist.yml
	# and applies defaultPresets=["basic"]
	pnpm exec filedist install
	node ../../.github/scripts/check-cli-config-symlinks.cjs
	test ! -e output/eslint/conf/globals.js
	test -e output/lastUpdated

	# check without --packages: reads entries from .filedist.yml
	pnpm exec filedist check

	# check detects symlink drift and extract repairs it
	@retarget_symlink() { \
		link_path="$$1"; \
		target_path="$$2"; \
		rm -f "$$link_path"; \
		ln -s "$$(cd "$$(dirname "$$target_path")" && pwd -P)/$$(basename "$$target_path")" "$$link_path"; \
	}; \
	retarget_symlink output/data-symlink/user1.json output/docs/README.md
	! pnpm exec filedist check
	pnpm exec filedist install
	node ../../.github/scripts/check-cli-config-symlinks.cjs

	# remove entries from lockfile
	pnpm exec filedist remove --all
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
	test ! -e output/data-symlink/user1.json
	test ! -e output/data-symlink/users-dataset
	test -e output/lastUpdated
	test ! -e .filedist.yml
	test ! -e .filedist.lock

	# --- Test 2: explicit --presets overrides defaultPresets ---
	cp -f .filedist.yml.orig .filedist.yml
	rm -rf output
	pnpm exec filedist install --presets "nested-eslint"
	test -e output/nested-eslint/conf/globals.js
	test ! -e output/docs/adrs/adr-001-sample1.md
	test ! -e output/data/users-dataset/user1.json
	test -e output/lastUpdated
	pnpm exec filedist check --presets "nested-eslint"
	pnpm exec filedist remove --all
	test ! -e output/nested-eslint/conf/globals.js
	test ! -e .filedist.yml
	test ! -e .filedist.lock

	# --- Test 3: presets command lists all preset tags ---
	cp -f .filedist.yml.orig .filedist.yml
	rm -rf output
	pnpm exec filedist presets | grep -x "basic"
	pnpm exec filedist presets | grep -x "extra"
	pnpm exec filedist presets | grep -x "nested-eslint"

	# --- Test 4: --all ignores defaultPresets and processes every configured entry ---
	cp -f .filedist.yml.orig .filedist.yml
	rm -f .filedist.lock
	rm -rf output
	pnpm exec filedist install --all
	node ../../.github/scripts/check-cli-config-symlinks.cjs
	test -e output/eslint/conf/globals.js
	test -e output/nested-eslint/conf/globals.js
	pnpm exec filedist check --all
	pnpm exec filedist remove --all
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
	test ! -e output/data-symlink/user1.json
	test ! -e output/data-symlink/users-dataset
	test ! -e output/nested-eslint/conf/globals.js
	test ! -e .filedist.yml
	test ! -e .filedist.lock

	# --- Test 5: remove only a specific package leaves other packages' files intact ---
	cp -f .filedist.yml.orig .filedist.yml
	rm -f .filedist.lock
	rm -rf output
	pnpm exec filedist install --all
	test -e output/eslint/conf/globals.js
	test -e output/docs/README.md
	test -e output/data/users-dataset/user1.json
	test -e output/nested-eslint/conf/globals.js
	# remove only mypackage sets; eslint@8 files must survive
	pnpm exec filedist remove mypackage
	test ! -e output/docs/README.md
	test ! -e output/data/users-dataset/user1.json
	test ! -e output/nested-eslint/conf/globals.js
	test -e output/eslint/conf/globals.js

	# --- Test 6: selector.basedir scopes file extraction to a subdirectory ---
	# With basedir: 'conf' on eslint@8, files are enumerated from <pkg>/conf/
	# and placed in the output WITHOUT the 'conf/' prefix.
	rm -f .filedist.lock
	rm -rf output
	printf 'sets:\n  - package: eslint@8\n    selector:\n      basedir: conf\n      files:\n        - "**"\n    output:\n      path: output/basedir-test\n      gitignore: false\n' > .filedist.yml
	pnpm exec filedist install
	test -e output/basedir-test/globals.js
	test ! -e output/basedir-test/conf/globals.js
	pnpm exec filedist check
	pnpm exec filedist remove --all
	test ! -e output/basedir-test/globals.js
	test ! -e .filedist.yml
	test ! -e .filedist.lock

	@echo "All config-file mode tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -f package.json
	@rm -f pnpm-lock.yaml
	@rm -f .filedist.lock
	@rm -f .filedist.yml
