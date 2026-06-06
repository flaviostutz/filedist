SHELL := /bin/bash

all: clean build test

lint:
	@echo "local-source-config has no lint. Ignoring."

build: install

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/
	cp package.json.orig package.json

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm install --no-frozen-lockfile

prepare-local-pkg:
	rm -rf local-pkg
	mkdir -p local-pkg/docs
	printf '# Local Readme\n' > local-pkg/docs/readme.md
	printf '# Local Guide\n' > local-pkg/docs/guide.md
	printf '{"name":"local-pkg","version":"0.0.0"}\n' > local-pkg/package.json

test: prepare-local-pkg
	@echo ""
	@echo ">>>> local-source-config"
	@rm -rf output
	@rm -f .filedist.lock
	@rm -f .filedist.yml

	# --- Test 1: install via CLI with file:// path ---
	pnpm exec filedist install "file://./local-pkg" --files "docs/**" --output output/local
	test -e output/local/docs/readme.md
	test -e output/local/docs/guide.md
	test -e .filedist.lock
	test -e .filedist.yml

	# lock file must record version "0" for local packages
	grep -F ": '0'" .filedist.lock

	# --- Test 2: check passes immediately after install ---
	pnpm exec filedist check

	# --- Test 3: install via config file ---
	@rm -rf output
	@rm -f .filedist.lock
	@rm -f .filedist.yml
	printf 'sets:\n  - package: "file://./local-pkg"\n    selector:\n      files:\n        - "docs/**"\n    output:\n      path: output/from-config\n' > .filedist.yml
	pnpm exec filedist install
	test -e output/from-config/docs/readme.md
	test -e output/from-config/docs/guide.md

	# lock file must record version "0" for local packages
	grep -F ": '0'" .filedist.lock

	pnpm exec filedist check

	# --- Test 4: update reflects local file changes ---
	printf '# Local Readme Updated\n' > local-pkg/docs/readme.md
	pnpm exec filedist update
	grep "Local Readme Updated" output/from-config/docs/readme.md
	pnpm exec filedist check

	# --- Test 5: remove all managed files ---
	pnpm exec filedist remove --all
	test ! -e output/from-config/docs/readme.md
	test ! -e .filedist.yml
	test ! -e .filedist.lock

	@echo "All local-source-config tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -rf local-pkg
	@rm -f pnpm-lock.yaml
	@rm -f package.json
	@rm -f .filedist.yml
	@rm -f .filedist.lock
