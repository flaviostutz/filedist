SHELL := /bin/bash

PARENT_TAG := v2.0.0
CHILD_TAG := v1.0.0

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm install --no-frozen-lockfile

prepare-config:
	PARENT_REPO_URL="file://$$(pwd)/repos/parent-repo"; \
	jq --arg parentRepo "$$PARENT_REPO_URL" '.filedist.sets[0].package = ($$parentRepo + "@$(PARENT_TAG)")' package.json.orig > package.json

prepare-repos:
	rm -rf repos
	mkdir -p repos/child-repo/child
	mkdir -p repos/parent-repo/docs
	printf '{"ok":true}\n' > repos/child-repo/child/data.json
	CHILD_REPO_URL="file://$$(pwd)/repos/child-repo"; \
	jq -n --arg childRepo "$$CHILD_REPO_URL" --arg childTag "$(CHILD_TAG)" '{sets:[{output:{path:".",gitignore:false}},{package:($$childRepo + "@" + $$childTag),source:"git",output:{path:"nested",gitignore:false}}]}' > repos/parent-repo/.filedistrc
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

test: clean install prepare-repos
	@echo ""
	@echo ">>>> git-sources-config"

	# --- Test 1: config from package.json "filedist" key ---
	make prepare-config
	pnpm exec filedist extract
	test -e output/docs/guide.md
	test -e output/nested/child/data.json
	test -e output/.filedist
	test -e output/nested/.filedist
	test ! -e output/.git
	test ! -e output/.filedistrc
	test ! -e output/nested/.git
	test ! -e output/nested/.filedistrc
	grep -F "file://$$(pwd)/repos/parent-repo" output/.filedist
	grep -F "file://$$(pwd)/repos/child-repo" output/nested/.filedist
	test ! -e .filedist-tmp
	grep -Fx ".filedist-tmp" .gitignore
	pnpm exec filedist check
	pnpm exec filedist purge
	test ! -e output/docs/guide.md
	test ! -e output/nested/child/data.json
	test ! -e .filedist-tmp

	# --- Test 2: config from .filedistrc ---
	make prepare-config
	jq '.filedist' package.json > .filedistrc
	jq 'del(.filedist)' package.json > package.json.tmp && mv package.json.tmp package.json
	pnpm exec filedist extract
	test -e output/docs/guide.md
	test -e output/nested/child/data.json
	test -e output/.filedist
	test -e output/nested/.filedist
	test ! -e output/.git
	test ! -e output/.filedistrc
	test ! -e output/nested/.git
	test ! -e output/nested/.filedistrc
	pnpm exec filedist check
	pnpm exec filedist purge
	test ! -e output/docs/guide.md
	test ! -e output/nested/child/data.json

	# restore original package.json
	cp package.json.orig package.json
	rm -f .filedistrc

	@echo "All git source config tests passed"

clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -rf repos
	@rm -rf .filedist-tmp
	@rm -f pnpm-lock.yaml
	@rm -f .filedistrc
	@cp -f package.json.orig package.json