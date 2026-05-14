SHELL := /bin/bash
.DEFAULT_GOAL := up

.PHONY: setup up down

setup:
	bash scripts/dev-setup.sh

up:
	bash scripts/dev-up.sh

down:
	bash scripts/dev-down.sh
