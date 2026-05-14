SHELL := /bin/bash
.DEFAULT_GOAL := up

.PHONY: setup up down

setup:
	bash infra/scripts/dev-setup.sh

up:
	bash infra/scripts/dev-up.sh

down:
	bash infra/scripts/dev-down.sh
