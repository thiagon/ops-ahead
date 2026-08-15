from __future__ import annotations

from kubernetes import client, config


class WorkflowClient:
    """Thin wrapper around the `argoproj.io/v1alpha1 Workflow` custom resource
    — the consumer creates it directly via the Kubernetes API, never through
    `argo-server`'s REST API (see spec.md "Decisões de arquitetura": avoids
    depending on argo-server's auth mode as a separate secret to manage)."""

    GROUP = "argoproj.io"
    VERSION = "v1alpha1"
    PLURAL = "workflows"

    def __init__(self, api: client.CustomObjectsApi):
        self._api = api

    @classmethod
    def from_cluster(cls) -> WorkflowClient:
        try:
            config.load_incluster_config()
        except config.ConfigException:
            config.load_kube_config()
        return cls(client.CustomObjectsApi())

    def create(self, namespace: str, manifest: dict) -> dict:
        return self._api.create_namespaced_custom_object(
            group=self.GROUP, version=self.VERSION, namespace=namespace, plural=self.PLURAL, body=manifest
        )

    def get(self, namespace: str, name: str) -> dict | None:
        try:
            return self._api.get_namespaced_custom_object(
                group=self.GROUP, version=self.VERSION, namespace=namespace, plural=self.PLURAL, name=name
            )
        except client.ApiException as exc:
            if exc.status == 404:
                return None
            raise
