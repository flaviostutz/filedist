SHELL := /bin/bash

all: clean build test

lint:
	@echo "cli-config-simple has no lint. Ignoring."

build: install

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm install --no-frozen-lockfile

test:
	@echo ""
	@echo ">>>> cli-config-simple"
	@rm -rf output
	@rm -f .filedist.lock
	@rm -f .filedistrc.yml

	# Nothing will be installed (no config file yet and no package in cli args)
	! pnpm exec filedist install

	# install eslint with pinned version 8.0.0
	test ! -e .filedistrc.yml
	test ! -e .filedist.lock
	test ! -e output/eslint/README.md
	pnpm exec filedist install eslint@8.0.0 --files README.md,package.json --output output/eslint
	test -e .filedistrc.yml
	test -e .filedist.lock
	test -e output/eslint/README.md
	grep "8.0.0" output/eslint/package.json

	# change eslint to version range ^8.0.0
	pnpm exec filedist install eslint@^8.0.0 --files README.md,package.json --output output/eslint
	grep "eslint@^8.0.0" .filedistrc.yml
	grep "8.0.0" output/eslint/package.json

	# bump package to latest version possible 8.5.7
	pnpm exec filedist update
	grep "eslint@^8.0.0: 8.57.1" .filedist.lock
	grep "8.57.1" output/eslint/package.json

	# install chalk package
	pnpm exec filedist install chalk@4 --files README.md,package.json --output output/chalk
	grep "eslint@^8.0.0" .filedistrc.yml
	grep "chalk@4" .filedistrc.yml
	grep "eslint@^8.0.0: 8.57.1" .filedist.lock
	grep "chalk@4: 4.1.2" .filedist.lock
	grep "8.57.1" output/eslint/package.json
	grep "4.1.2" output/chalk/package.json

	# remove eslint
	pnpm exec filedist remove eslint
	! grep "eslint@^8.0.0" .filedistrc.yml
	! grep "eslint@^8.0.0: 8.57.1" .filedist.lock
	! grep "8.57.1" output/eslint/package.json
	test ! -e output/eslint/README.md
	grep "chalk@4" .filedistrc.yml
	grep "4.1.2" output/chalk/package.json

	pnpm exec filedist update
	grep "chalk@4" .filedistrc.yml
	grep "4.1.2" output/chalk/package.json

	# Remove all managed files
	pnpm exec filedist remove --all
	! grep "eslint@^8.0.0" .filedistrc.yml
	! grep "chalk@4" .filedistrc.yml
	! grep "eslint@^8.0.0: 8.57.1" .filedist.lock
	! grep "chalk@4: 4.1.2" .filedist.lock
	! grep "8.57.1" output/eslint/package.json
	! grep "4.1.2" output/chalk/package.json
	test ! -e output/eslint/README.md
	test ! -e output/chalk/README.md

	@echo "All cli-config-simple tests passed"

clean:
	@rm -rf node_modules
	@rm -f pnpm-lock.yaml
	@rm -rf output
	@rm -f .filedist.lock
	@rm -f .filedistrc.yml
