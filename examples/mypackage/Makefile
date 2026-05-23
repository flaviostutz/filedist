SHELL := /bin/bash

all: clean build test

lint:
	@echo "mypackage has no lint. Ignoring."

test:
	@echo "mypackage has no tests. Ignoring"

install:
	cp -f package.json.orig package.json
	# replace the dependency with the local package
	pnpm add filedist@file:../../lib/dist/filedist-0.0.1.tgz
	@# update local tar gz checksum
	pnpm install

build: install
	# initialize filedist package with local files to be shared
	pnpm exec filedist init --files ".configs/**/*,docs/**/*,data/**/*" --package-config mypackage.yml

	# use custom package sets
	cp -f .filedist-package.yml.orig .filedist-package.yml

	pnpm pack --pack-destination dist

clean:
	@rm -rf node_modules
	@rm -rf dist
	@rm -rf lib
	@rm -rf bin
	@rm -f package.json
	@rm -f pnpm-lock.yaml
	@rm -f .filedist-package.yml

