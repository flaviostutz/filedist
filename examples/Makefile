SHELL := /bin/bash

# Delegate all targets to example modules for full integration testing of the CLI and its config handling.
%:
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in mypackage..."
	make -C mypackage $@
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in mypackage-consumer..."
	make -C mypackage-consumer $@
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in cli-config..."
	make -C cli-config $@
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in cli-config-simple..."
	make -C cli-config-simple $@
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in git-sources-config..."
	make -C git-sources-config $@
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in cli-config-simple..."
	make -C cli-config-simple $@
	@echo ""
	@echo ""
	@echo ">>>>Running '$@' in split-set-config..."
	make -C split-set-config $@
