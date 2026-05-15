SHELL := /bin/bash
.DEFAULT_GOAL := up

# Defaults para make logs
APP ?= argocd-server
NS  ?= infra

.PHONY: setup up down sync argo logs

## Cria .env a partir de .env.example se ainda não existir (target de arquivo).
.env:
	cp .env.example .env
	@echo "⚠  .env criado — preencha ANTHROPIC_API_KEY e OPENAI_API_KEY antes de usar o LiteLLM."

setup: .env
	bash infra/scripts/dev-setup.sh

up:
	bash infra/scripts/dev-up.sh

down:
	bash infra/scripts/dev-down.sh

## Re-push do working dir pro Gitea local + refresh ArgoCD.
## Use após editar charts/manifests sem precisar rebuildar o cluster.
sync:
	bash infra/scripts/dev-sync.sh

## Verifica se o ArgoCD subiu e mostra o status de todos os Applications.
## Útil logo após `make up` para acompanhar a sincronização.
argo:
	@echo "━━━ Pods ArgoCD (namespace: infra) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@kubectl get pods -n infra -l app.kubernetes.io/part-of=argocd \
	  -o wide 2>/dev/null || kubectl get pods -n infra -o wide
	@echo ""
	@echo "━━━ Applications (App-of-Apps) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	@kubectl get applications -n infra \
	  -o custom-columns='NAME:.metadata.name,HEALTH:.status.health.status,SYNC:.status.sync.status,MESSAGE:.status.conditions[0].message' \
	  2>/dev/null || echo "  Nenhum Application encontrado — ArgoCD ainda inicializando"

## Segue os logs de um pod pelo label app.kubernetes.io/name.
## Uso:
##   make logs                          # argocd-server no namespace infra
##   make logs APP=mlflow NS=ml
##   make logs APP=litellm NS=agent
##   make logs APP=vault NS=infra
logs:
	kubectl logs -n $(NS) -l app.kubernetes.io/name=$(APP) \
	  --tail=200 -f --max-log-requests=6 2>/dev/null || \
	kubectl logs -n $(NS) -l app=$(APP) \
	  --tail=200 -f --max-log-requests=6
