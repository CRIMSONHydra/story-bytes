# Stage 1: Build
FROM node:20-bullseye-slim AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies (cached layer)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# Compile backend TS → JS
COPY backend/ backend/
RUN pnpm --filter backend build

# Build frontend
COPY frontend/ frontend/
RUN pnpm --filter frontend build

# Stage 2: Production runtime
FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor wget curl \
    python3 python3-pip python3-pil \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install production Node dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --prod

# Copy compiled backend
COPY --from=build /app/backend/dist backend/dist

# Copy frontend static bundle
COPY --from=build /app/frontend/dist frontend/dist

# Copy database schema and ingestion scripts
COPY db/ db/
COPY ingestion/ ingestion/
RUN pip3 install --no-cache-dir -r ingestion/requirements.txt

# Copy Docker configs
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/supervisor.conf /etc/supervisor/conf.d/supervisor.conf
COPY docker/start.sh /start.sh

# Remove default nginx site
RUN rm -f /etc/nginx/sites-enabled/default

VOLUME ["/app/dataset", "/app/processed"]
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

ENTRYPOINT ["/start.sh"]
