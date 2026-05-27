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

# Follow pod logs by label. Usage: make logs APP=mlflow NS=ml
.PHONY: logs
logs:
	kubectl logs -n $(NS) -l app.kubernetes.io/name=$(APP) \
	  --tail=200 -f --max-log-requests=6 2>/dev/null || \
	kubectl logs -n $(NS) -l app=$(APP) \
	  --tail=200 -f --max-log-requests=6
