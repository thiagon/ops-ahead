import { readFile } from 'node:fs/promises';

/**
 * Writes an origin's signing key to the Vault path ui-orchestrator owns. The
 * whole app keeps one path with one key per origin — never a path per
 * integration, and never shared with another app.
 *
 * Reading is external-secrets' job, not this service's: the gateway receives
 * the secret as an ExternalSecret like every other credential.
 */
export interface SecretStore {
  writeOriginSecret(tenantId: string, source: string, secret: string): Promise<void>;
}

export interface VaultOptions {
  address: string;
  kvMount: string;
  /** The KV key holding every origin secret of this app (1 app = 1 path). */
  secretPath: string;
  role: string;
  tokenPath: string;
}

/** Kubernetes auth — the same login external-secrets performs. */
async function login(options: VaultOptions): Promise<string> {
  const jwt = await readFile(options.tokenPath, 'utf8');
  const response = await fetch(`${options.address}/v1/auth/kubernetes/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: options.role, jwt }),
  });
  if (!response.ok) {
    throw new Error(`vault login failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { auth: { client_token: string } };
  return body.auth.client_token;
}

export function createVaultSecretStore(options: VaultOptions): SecretStore {
  return {
    async writeOriginSecret(tenantId, source, secret) {
      const token = await login(options);
      const url = `${options.address}/v1/${options.kvMount}/data/${options.secretPath}`;

      // KV v2 patch merges into the existing key, so writing one origin's
      // secret never drops the others sharing this path.
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/merge-patch+json',
          'x-vault-token': token,
        },
        body: JSON.stringify({ data: { [`${tenantId}_${source}`.toUpperCase()]: secret } }),
      });
      if (!response.ok) {
        throw new Error(`vault write failed: ${response.status} ${await response.text()}`);
      }
    },
  };
}
