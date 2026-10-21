FROM python:3.12-slim

# Most container hosts run the app as a non-root user, so anything written at
# runtime (the trained model pickle, saved CSVs) must be owned by that user.
RUN useradd -m -u 1000 user

ENV HOME=/home/user \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

WORKDIR /app

COPY --chown=user:user requirements-deploy.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements-deploy.txt

COPY --chown=user:user . /app

USER user

EXPOSE 8000

# Shell form is deliberate: the host injects $PORT at runtime and exec form
# would pass it through as a literal string instead of expanding it.
#
# A single worker is required, not a tuning choice: the dataset, the trained
# model and the live-intake thread all live in this process's memory, so a
# second worker would serve a different dataset. Threads carry the concurrency.
CMD gunicorn --bind "0.0.0.0:${PORT}" --workers 1 --threads 8 --timeout 180 --graceful-timeout 30 --access-logfile - wsgi:app
