SHELL := /bin/bash

%:
	@echo ''
	@echo '>>> Running /lib:$@...'
	@make -C lib $@
	@echo ''

	@# Building /examples is important as it simulates the usage of the lib as external
	@# so that is get problems with Lambda bundling, which is sensitive when distributing libs
	@echo ''
	@echo '>>> Running /examples:$@...'
	@echo ''
	@STAGE=dev make -C examples $@

publish:
	make -C lib publish

prepare:
	@echo "Run 'nvm use; corepack enable'"

bump:
	npx -y agentme@latest
