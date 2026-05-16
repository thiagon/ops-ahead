# infra/scripts — Regras de desenvolvimento

## Princípio central

`dev-up.sh` é o script de bootstrap do ambiente local. Ele deve ser **estável**: rodar sem alterações mesmo quando novos serviços, secrets ou namespaces são adicionados à plataforma. Qualquer mudança que exija editar o script ao adicionar um serviço é um defeito de design.

---

## Regras obrigatórias

### 1. Sem listas hardcoded de serviços ou secrets

Loops e esperas devem operar sobre **todos os recursos do tipo**, descobertos dinamicamente no cluster.

```bash
# ERRADO — quebra ao adicionar qualquer novo ExternalSecret
for es in grafana-secret/infra minio-secret/data litellm-secret/llm; do ...

# CORRETO — funciona para qualquer quantidade de ExternalSecrets
kubectl wait externalsecret --all --all-namespaces --for=condition=Ready
```

A mesma regra vale para namespaces, pods, aplicações ArgoCD ou qualquer outro recurso.

### 2. Novos secrets vão ao Vault, não ao script

Ao adicionar um novo serviço que precisa de credenciais:

1. Adicione o `vault kv put secret/<nome>` no bloco **Bootstrap Vault** do `dev-up.sh`
2. Crie o `ExternalSecret` no chart do serviço (ou em `infra/charts/infra-secrets/`)
3. **Não crie** `ksecret` nem `kubectl create secret` no script

O ESO sincroniza automaticamente. O script não precisa saber quais secrets existem.

### 3. Sem referências a nomes de namespaces fora do `namespaces.yaml`

Namespaces devem ser declarados em `infra/apps/namespaces.yaml`. O script lê esse arquivo via `namespaces_from_yaml`. Não adicione nomes de namespace literais em outros pontos do script.

### 4. Bootstrap de infraestrutura, não de aplicação

O `dev-up.sh` instala a fundação (ArgoCD, Vault, Gitea, ESO) e faz o push inicial para o Gitea. O ArgoCD assume o controle de tudo depois disso. Qualquer lógica que pertença ao ciclo de vida de uma aplicação específica deve estar no chart dessa aplicação.

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
3. Adicionar vault kv put no bloco Bootstrap Vault do dev-up.sh (se precisar de secret)
4. Criar ExternalSecret no chart infra-secrets (se precisar de secret)
5. dev-sync.sh  →  ArgoCD sincroniza tudo automaticamente
```

O `dev-up.sh` **não precisa ser editado** nos passos 1, 2, 4 e 5.
