SHELL := /bin/bash

PARENT_TAG := v2.0.0
CHILD_TAG := v1.0.0

all: clean build test

lint:
	@echo "git-sources-config has no lint. Ignoring."

build: install

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/
	cp -f package.json.orig package.json

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm install --no-frozen-lockfile

prepare-config:
	PARENT_REPO_URL="file://$$(pwd)/repos/parent-repo"; \
	printf "sets:\n  - package: \"git:$$PARENT_REPO_URL@$(PARENT_TAG)\"\n    output:\n      path: output\n" > .filedist.yml

prepare-repos:
	rm -rf repos
	mkdir -p repos/child-repo/child
	mkdir -p repos/parent-repo/docs
	printf '{"ok":true}\n' > repos/child-repo/child/data.json
	CHILD_REPO_URL="file://$$(pwd)/repos/child-repo"; \
	printf "sets:\n  - output:\n      path: .\n      gitignore: false\n  - package: \"git:$$CHILD_REPO_URL@$(CHILD_TAG)\"\n    output:\n      path: nested\n      gitignore: false\n" > repos/parent-repo/.filedist-package.yml
	printf '# Parent Guide\n' > repos/parent-repo/docs/guide.md
	git -C repos/child-repo init
	git -C repos/child-repo config user.email 'filedist@example.com'
	git -C repos/child-repo config user.name 'filedist tests'
	git -C repos/child-repo add .
	git -C repos/child-repo commit -m 'child fixture'
	git -C repos/child-repo tag $(CHILD_TAG)
	git -C repos/parent-repo init
	git -C repos/parent-repo config user.email 'filedist@example.com'
	git -C repos/parent-repo config user.name 'filedist tests'
	git -C repos/parent-repo add .
	git -C repos/parent-repo commit -m 'parent fixture'
	git -C repos/parent-repo tag $(PARENT_TAG)

test: prepare-repos
	@echo ""
	@echo ">>>> git-sources-config"
	@rm -rf output

	# --- Test 1: config from .filedist.yml ---
	make prepare-config
	pnpm exec filedist install
	test -e output/docs/guide.md
	test -e output/nested/child/data.json
	test -e .filedist.lock
	test ! -e output/.git
	test ! -e output/.filedist-package.yml
	test ! -e output/nested/.git
	test ! -e output/nested/.filedist-package.yml
	grep -F "file://$$(pwd)/repos/parent-repo" .filedist.lock
	grep -F "file://$$(pwd)/repos/child-repo" .filedist.lock
	test ! -e .filedist-tmp
	grep -Fx ".filedist-tmp" .gitignore
	pnpm exec filedist check
	pnpm exec filedist remove --all
	test ! -e output/docs/guide.md
	test ! -e output/nested/child/data.json
	test ! -e .filedist-tmp
	test ! -e .filedist.yml
	test ! -e .filedist.lock

	@echo "All git-prefixed source config tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -rf repos
	@rm -rf .filedist-tmp
	@rm -f pnpm-lock.yaml
	@rm -f package.json
	@rm -f .filedist.yml
	@rm -f .filedist.lock
