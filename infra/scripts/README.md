# infra/scripts — Regras de desenvolvimento

## Princípio central

Os scripts desta pasta (`dev-up.sh`, `dev-sync.sh`, `dev-health.sh`, `_lib.sh`, …) são o
bootstrap e a operação do ambiente local. Todos devem ser **estáveis**: rodar sem alteração
mesmo quando novos serviços, apps, secrets ou namespaces são adicionados à plataforma.
Qualquer mudança que exija editar um script ao adicionar um serviço é um defeito de design.

---

## Regras obrigatórias

### 1. Sem listas hardcoded

Loops e esperas operam sobre **todos os itens do tipo**, descobertos dinamicamente — no
cluster via `kubectl`, no repositório via glob dos manifestos que já declaram a informação.

```bash
# ERRADO — quebra ao adicionar qualquer novo ExternalSecret
for es in grafana-secret/infra minio-secret/data; do ...

# CORRETO — funciona para qualquer quantidade de ExternalSecrets
kubectl wait externalsecret --all --all-namespaces --for=condition=Ready
```

```bash
# ERRADO — adicionar um app exige editar o script, e o que for esquecido falha calado
for app in data-ingest data-runner ui-gateway; do ...

# CORRETO — quem tem o overlay é quem entra no loop
for overlay in apps/*/chart/values-dev.yaml; do
  app=$(basename "$(dirname "$(dirname "$overlay")")")
  ...
done
```

Vale para namespaces, pods, Applications do ArgoCD, apps de `apps/`, charts de
`infra/charts/` ou qualquer outro conjunto que cresça com a plataforma.

### 2. Novos secrets: ExternalSecret + var no `.env`

O `dev-up.sh` monta os `vault kv put` sozinho: lê todo
`infra/charts/*/templates/external-secret.yaml`, usa `remoteRef.key` como caminho no Vault
e `remoteRef.property` como nome da variável, e pega o valor da var de mesmo nome no `.env`.

Ao adicionar um serviço que precisa de credencial:

1. Crie o `ExternalSecret` no chart do serviço (ou em `infra/charts/infra-secrets/`)
2. Adicione a var em `.env.example` (e no seu `.env`) com **o mesmo nome** de `remoteRef.property`
3. **Não crie** `kubectl create secret` nem `vault kv put` literal no script

O script falha explicitamente se a var declarada no `ExternalSecret` não existir no `.env`.

### 3. Sem referências a nomes de namespaces fora do `namespaces.yaml`

Namespaces são declarados em `infra/apps/namespaces.yaml` e lidos de lá pelo script.
Não adicione nomes de namespace literais em outros pontos.

### 4. Bootstrap de infraestrutura, não de aplicação

O `dev-up.sh` instala a fundação (ArgoCD, Vault, Gitea, ESO) e faz o push inicial para o
Gitea. O ArgoCD assume o controle depois disso. Lógica do ciclo de vida de uma aplicação
específica pertence ao chart dessa aplicação.

### 5. Idempotência obrigatória

Cada operação deve ser segura para rodar múltiplas vezes:
- `kubectl apply` em vez de `kubectl create`
- `vault auth enable ... 2>/dev/null || true`
- `helm upgrade --install` em vez de `helm install`

---

## Fluxo de adição de um novo serviço

```
1. Criar chart em infra/charts/<nome>/
2. Criar app em infra/apps/<nome>.yaml
3. Criar ExternalSecret no chart + var de mesmo nome no .env (se precisar de secret)
4. make sync  →  ArgoCD sincroniza tudo automaticamente
```

Nenhum passo edita script.
