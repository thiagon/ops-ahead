from __future__ import annotations


def main() -> None:
    import uvicorn

    from src.app import create_app
    from src.k8s import WorkflowClient
    from src.settings import Settings

    settings = Settings()
    app = create_app(settings, WorkflowClient.from_cluster())
    uvicorn.run(app, host="0.0.0.0", port=settings.http_port)


if __name__ == "__main__":
    main()
