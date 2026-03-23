# Stage 1: Build frontend
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies (cached layer)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# Type-check backend
COPY backend/ backend/
RUN pnpm --filter backend build

# Build frontend
COPY frontend/ frontend/
RUN pnpm --filter frontend build

# Stage 2: Production runtime
FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip py3-pillow tesseract-ocr postgresql-client
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install all Node dependencies (tsx needed to run TS source)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

# Copy backend source (tsx runs TS directly)
COPY backend/src backend/src
COPY backend/tsconfig.json backend/

# Copy frontend build artifacts
COPY --from=build /app/frontend/dist frontend/dist

# Copy database schema and ingestion scripts
COPY db/ db/
COPY ingestion/ ingestion/
RUN pip3 install --no-cache-dir --break-system-packages -r ingestion/requirements.txt

# Runtime volumes for data persistence
VOLUME ["/app/dataset", "/app/processed"]

EXPOSE 5001
ENV NODE_ENV=production
CMD ["npx", "tsx", "backend/src/server.ts"]
