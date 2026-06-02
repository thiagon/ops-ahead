SHELL := /bin/bash
.DEFAULT_GOAL := up

# `make logs` defaults
APP ?= argocd-server
NS  ?= infra


# Create .env from .env.example on first run.
.env:
	cp .env.example .env
	@echo "⚠  .env created — fill in the values before running make up."

# Install tools (kubectl, helm, k3d, yq).
.PHONY: setup
setup: .env
	bash infra/scripts/dev-setup.sh

# Bring up the k3d cluster and bootstrap GitOps.
.PHONY: up
up:
	bash infra/scripts/dev-up.sh

# Tear down the k3d cluster.
.PHONY: down
down:
	bash infra/scripts/dev-down.sh

# Push working dir to Gitea + refresh ArgoCD (use after editing charts).
.PHONY: sync
sync:
	bash infra/scripts/dev-sync.sh

# Show ArgoCD pods + Applications status.
.PHONY: argo
argo:
	@kubectl get pods -n infra -l app.kubernetes.io/part-of=argocd -o wide 2>/dev/null \
	  || kubectl get pods -n infra -o wide
	@echo ""
	@kubectl get applications -n infra \
	  -o custom-columns='NAME:.metadata.name,HEALTH:.status.health.status,SYNC:.status.sync.status,MESSAGE:.status.conditions[0].message'

# Generate bcrypt hash for a password. Usage: make bcrypt PWD=ops-ahead-dev
.PHONY: bcrypt
bcrypt:
	@docker run --rm httpd:alpine htpasswd -nbBC 10 "" "$(PWD)" 2>/dev/null \
	  | tr -d ':\n' | sed 's/$$2y/$$2a/' && echo

# Build a custom app image and import it into k3d. Usage: make build APP=data-ingest
.PHONY: build
build:
	@source .env && echo "$$GITHUB_PERSONAL_ACCESS_TOKEN" | \
	  docker login ghcr.io -u token --password-stdin 2>/dev/null || true
	docker build -t gitea.ops-ahead.local/ops-ahead/$(APP):latest apps/$(APP)/
	k3d image import gitea.ops-ahead.local/ops-ahead/$(APP):latest -c ops-ahead

# Follow pod logs by label. Usage: make logs APP=mlflow NS=ml
.PHONY: logs
logs:
	kubectl logs -n $(NS) -l app.kubernetes.io/name=$(APP) \
	  --tail=200 -f --max-log-requests=6 2>/dev/null || \
	kubectl logs -n $(NS) -l app=$(APP) \
	  --tail=200 -f --max-log-requests=6
