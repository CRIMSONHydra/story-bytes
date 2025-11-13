# Backend (Express + TypeScript)

This folder will house the REST API / orchestration layer built with **Express** and **TypeScript**. Planned responsibilities:

- expose ingestion endpoints to drop new EPUB/JSON payloads into the database;
- provide retrieval and summarisation APIs used by the React client;
- enqueue asynchronous jobs (OCR, embeddings) by publishing to the worker queue.

# Getting started

```bash
# Install dependencies (safe to re-run)
npm install

# Start dev server (http://localhost:5001 by default)
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## Environment variables

| Variable       | Description                                             | Default                                               |
|----------------|---------------------------------------------------------|-------------------------------------------------------|
| `PORT`         | HTTP port the Express server listens on                 | `5001`                                                |
| `DATABASE_URL` | PostgreSQL connection string (pg compatible URI)        | `postgres://postgres:postgres@localhost:5432/story_bytes` |

Create a `.env` file (not committed) to override these as needed.

## Tooling

- **Express 5** + TypeScript
- `pg` connection pool with a shared health-check helper
- Flat-config **ESLint** (`npm run lint` / `npm run lint:fix`)
- **Vitest** + Supertest for API tests (`npm run test`, `npm run test:watch`)

## TODO / Next steps

- Add database migration tooling (Drizzle ORM / Knex).
- Flesh out routing, controllers, and validation (`zod`).
- Integrate Redis/BullMQ for async jobs (OCR/embeddings).
- Add request logging / OpenTelemetry tracing.
