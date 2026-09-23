# Runbook — domínio e TLS na VM da Hetzner

O nome é comprado na Spaceship. DNS, proxy e certificados ficam na Cloudflare. O Traefik na VM termina o HTTPS na porta 443 com o certificado de origem que a Cloudflare emite.

O modo Flexible da Cloudflare só criptografa o trecho do navegador até a borda. A VM continua em HTTP. Este runbook usa **Full (strict)**: o navegador vê o certificado público da Cloudflare, e o trecho Cloudflare → VM também vai em TLS.

O domínio é `ops-ahead.xyz`. O IPv4 é o que a Hetzner mostra em **Primary IPs** do servidor.

## 1. Comprar o domínio

Feito: `ops-ahead.xyz` na Spaceship. A renovação automática fica desligada.

## 2. Entregar o DNS à Cloudflare

1. Crie uma conta grátis em [dash.cloudflare.com](https://dash.cloudflare.com) e adicione o domínio.
2. A Cloudflare mostra dois nameservers. Na Spaceship, no domínio, substitua os nameservers padrão por esses dois.
3. Espere o status do domínio na Cloudflare ficar ativo.

## 3. Apontar só ui / auth / gateway para a VM

Não use curinga `*`. Ferramentas internas (ArgoCD, Vault, Grafana, …) **não**
entram no DNS público — só `*.ops-ahead.localtest.me` no cluster, acessíveis
via `make tunnel`.

Em **DNS → Records**, crie (e apague o `*` se existir):

| Tipo | Nome | Conteúdo | Proxy |
|------|------|----------|--------|
| A | `ui` | IPv4 público da VM | ligado (nuvem laranja) |
| A | `auth` | mesmo IPv4 | ligado |
| A | `gateway` | mesmo IPv4 | ligado |

Deixe **SSL/TLS** em **Flexible** até o passo 6. Mudar para Full (strict) antes do Traefik responder na 443 derruba o site (erro 526).

## 4. Certificado de origem

Em **SSL/TLS → Origin Server → Create Certificate**:

- Hostnames: `*.ops-ahead.xyz` e `ops-ahead.xyz`
- Validade: 15 anos
- Formato da chave: PEM

Guarde os dois blocos (`origin.pem` e `origin.key`). A Cloudflare mostra a chave privada uma vez. Esses arquivos ficam na VM e **não entram no git**.

## 5. Instalar o certificado no Traefik

O k3s sobe o Traefik em `kube-system`. O secret tem de estar nesse namespace para o chart enxergar o certificado padrão:

```bash
kubectl -n kube-system create secret tls cloudflare-origin \
  --cert=origin.pem --key=origin.key
```

Em `infra/apps/traefik-config.yaml`, no `valuesContent`, além dos `additionalArguments` que já existem:

```yaml
tlsStore:
  default:
    defaultCertificate:
      secretName: cloudflare-origin
```

Cada Ingress público sai do entrypoint `web` para `websecure` e ganha um bloco `tls` sem `secretName` (vale o certificado padrão). Exemplo:

```yaml
annotations:
  traefik.ingress.kubernetes.io/router.entrypoints: websecure
  traefik.ingress.kubernetes.io/router.tls: "true"
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - ui.ops-ahead.xyz
  rules:
    - host: ui.ops-ahead.xyz
```

Hosts públicos e env das apps — em `apps/<app>/chart/`:
- `values-prod.yaml` → produção (`*.ops-ahead.xyz`, HTTPS)
- `values-local.yaml` → k3d (`*.ops-ahead.localtest.me`, HTTP; injetado pelo reconcile)
- `values-dev.yaml` → só tag de imagem (CI)

Authentik (sem imagem em `apps/`) usa `infra/charts/infra-authentik/values.yaml` +
`values-local.yaml`.

| Host | Onde |
|------|------|
| `ui` | `apps/ui-frontend/chart/values-prod.yaml` (+ `values-local.yaml` no k3d) |
| `gateway` | `apps/ui-gateway/chart/values-prod.yaml` (+ `values-local.yaml` no k3d) |
| `auth` | `infra/charts/infra-authentik/values.yaml` (+ `values-local.yaml` no k3d) |
| `vault`, `argocd`, `grafana`, `prometheus`, `mlflow`, `minio`, `gitea` | `infra/apps/ingresses.yaml` — só `*.ops-ahead.localtest.me` (tunnel) |

`gitea.ops-ahead.localtest.me` e as demais URLs internas não têm registro em
`ops-ahead.xyz`. Na VM ou no k3d: HTTP na :80. Do laptop contra a VM:

```bash
# .env: OPS_AHEAD_VM_HOST=<ipv4>
make down    # se o k3d estiver segurando :80
make tunnel  # SSH LocalForward 80+443; Ctrl-C fecha
```

Com o tunnel aberto: `http://grafana.ops-ahead.localtest.me`,
`http://argocd.ops-ahead.localtest.me`, etc. (`localtest.me` → `127.0.0.1`).

No gateway (`apps/ui-gateway/chart/values-prod.yaml`):

```yaml
httpsEnabled: "true"
corsOrigins:
  - https://ui.ops-ahead.xyz
authentikIssuer: https://auth.ops-ahead.xyz/application/o/gateway-web/
frontendOrigin: https://ui.ops-ahead.xyz
publicUrl: https://gateway.ops-ahead.xyz
sessionCookieDomain: ops-ahead.xyz
```

`authentikInternalOrigin` permanece o Service interno, em HTTP.

No Authentik (produção):

```yaml
hosts:
  - auth.ops-ahead.xyz
# AUTHENTIK_HOST
value: https://auth.ops-ahead.xyz
# gateway.redirectUri
redirectUri: https://gateway.ops-ahead.xyz/auth/callback
```

O Ingress do Authentik em produção leva as anotações `websecure` e `router.tls: "true"`.

Commita os YAML, faz push e espera o ArgoCD sincronizar. O secret `cloudflare-origin` não está no git; um prune não pode apagá-lo.

## 6. Abrir a 443 e ligar o Full (strict)

No firewall da Hetzner anexado ao servidor, libere entrada TCP **443**. Se o `ufw` da VM estiver ativo, a mesma porta.

Confira na VM, com o host de um Ingress:

```bash
curl -vk --resolve ui.ops-ahead.xyz:443:127.0.0.1 https://ui.ops-ahead.xyz/
```

A resposta pode ser 200, 302 ou 401. O que importa é o TLS completar. Aí, na Cloudflare:

1. **SSL/TLS → Overview → Full (strict)**. O certificado de origem é aceito nesse modo.
2. **SSL/TLS → Edge Certificates → Always Use HTTPS**.

O browser abre `https://ui.ops-ahead.xyz` com cadeado válido. `auth` e `gateway` usam os registros A do passo 3.
