all: clean build test

lint:
	@echo "mypackage-consumer has no lint. Ignoring."

install:
	# copy local relative dependencies (required by local filedist package)
	mkdir -p ../lib/dist
	cp -R ../../lib/dist/filedist-0.0.1.tgz ../lib/dist/
	cp -f package.json.orig package.json

	pnpm add filedist@file:../lib/dist/filedist-0.0.1.tgz
	pnpm add mypackage@file:../mypackage/dist/mypackage-1.0.0.tgz
	pnpm install --no-frozen-lockfile

build: install

test:
	@echo ""
	@echo ">>>> mypackage-consumer"
	rm -rf output
	cp -f mypackage.yml.orig mypackage.yml

	# Test 1
	rm -rf output
	rm -f mypackage.lock
	rm -f .filedist.lock
	pnpm exec mypackage install --output output
	test -e output/.configs/app.config.json
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js
	test -e output/conf/config-schema.js

	# mypackage.yml and mypackage.lock should be used (not .filedist.yml / .filedist.lock)
	test -e mypackage.yml
	test -e mypackage.lock
	test ! -e .filedist.lock

	# user1 should be managed and in .gitignore
	test -e output/data/users-dataset/user1.json
	grep -e "data/users-dataset/user1.json" output/.gitignore
	grep -e "data/users-dataset/user1.json" mypackage.lock

	# user2 should be unmanaged and not in .gitignore
	test -e output/data/users-dataset/user2.json
	! grep -e "data/users-dataset/user2.json" mypackage.lock
	! grep -e "data/users-dataset/user2.json" output/.gitignore

	# user3 was excluded, so it should not be extracted at all
	test ! -e output/data/users-dataset/user3.json

	! grep -e "conf/config-schema.js" mypackage.lock

	pnpm exec mypackage check --output output

	pnpm exec mypackage list --output output

	pnpm exec mypackage remove --output output
	test ! -e output/.configs/app.config.json
	test ! -e output/docs/adrs/adr-001-sample1.md

	# unmanaged files survive purge because they are not tracked in .filedist.lock
	test $$(find output -type f | wc -l) -eq 2
	test -e output/data/users-dataset/user2.json
	test -e output/conf/config-schema.js

	# Test 2 - basic preset
	pnpm exec mypackage install --output output --presets basic
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/data/users-dataset/user1.json
	# user2 is not in the basic preset, but it remains because it is unmanaged
	test -e output/data/users-dataset/user2.json
	test ! -e output/data/users-dataset/user3.json
	test -e output/conf/globals.js
	# config-schema.js is not included in basic preset, but it exists from previous and and in unmanaged, so it should be untouched
	test -e output/conf/config-schema.js

	# Test 3 - eslint preset
	rm -rf output
	pnpm exec mypackage install --output output --presets eslint
	test ! -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js
	test -e output/conf/config-schema.js

	# Test 4
	rm -rf output
	pnpm exec mypackage install --output output --presets "eslint,basic"
	test -e output/docs/adrs/adr-001-sample1.md
	test -e output/conf/globals.js
	test -e output/conf/config-schema.js

	# Test 5 - existing managed files that are not part of a profile are removed
	pnpm exec mypackage install --output output
	pnpm exec mypackage install --output output --presets special --verbose
	# part of the special profile
	test -e output/data/users-dataset/user2.json
	test ! -e output/docs/adrs/adr-001-sample1.md
	test ! -e output/data/users-dataset/user1.json
	test ! -e output/conf/globals.js
	# not managed, so shouldn't be deleted
	test -e output/conf/config-schema.js


clean:
	@rm -rf node_modules
	@rm -rf output
	@rm -f mypackage.yml
	@rm -f mypackage.lock
	@rm -f .filedist.lock
	@rm -f package.json
	@rm -f pnpm-lock.yaml
