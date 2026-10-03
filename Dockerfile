# Face ID: TypeScript (AIX) + Python (OpenCV) in one container.
# Based on `aix deploy --target docker`, plus the face models and settings for Render (see render.yaml).
#
# Local test:
#   docker build -t facial .
#   docker run -p 3000:3000 --env-file .env -e AIX_SECRET_KEY=$(openssl rand -hex 32) facial

FROM node:22-bookworm-slim AS build
WORKDIR /app
# python3 for the face engine; libglib2.0-0 is the one system library OpenCV's headless wheel expects.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# aix build imports every .py file once (a broken file fails the build) and installs the locked
# Python environment (uv.lock) into .aix/python/.venv.
RUN npx aix build
# The Python worker has no network access at runtime, so the ONNX models (~38 MB, SHA-256
# checked) are downloaded into the image here.
RUN python3 -m faceid.models
RUN npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# aix start checks that the Python environment is locked, so uv stays in the runtime image.
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
# Render sets PORT at runtime (default 10000); 3000 is the fallback for `docker run`.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build --chown=node:node /app /app
# Run as an unprivileged user. Python workers are child processes without secrets in their environment.
USER node
EXPOSE 3000
# Secrets come from the platform at runtime, never from the image:
#   AIX_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, FACEID_ENCRYPTION_KEY (+ SUPABASE_JWT_SECRET on legacy projects)
CMD ["npx", "aix", "start"]
