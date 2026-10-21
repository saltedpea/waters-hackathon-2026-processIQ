"""WSGI entry point.

`app.py` only calls bootstrap() under __main__, so a WSGI server would otherwise
serve an untrained model and an empty dataset. Training happens here at import,
before the server accepts its first request.
"""

from app import app, bootstrap

bootstrap()

__all__ = ["app"]
