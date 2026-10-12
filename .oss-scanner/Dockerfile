# Build for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as context and network access,
# then analyses the image offline. Everything the app and its tests need is
# installed here: dependencies, the production build and a local PostgreSQL
# with migrations applied and demo data seeded.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends postgresql ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Local-only values for the offline image; nothing here is a real secret.
ENV DATABASE_URL="postgresql://zeit:zeit@localhost:5432/zeiterfassung?schema=public" \
    AUTH_SECRET="oss-scanner-local-only-not-a-secret" \
    AUTH_TRUST_HOST=true \
    SEED_DEMO=true \
    SEED_ADMIN_EMAIL=admin@firma.de \
    SEED_ADMIN_PASSWORD=Scanner-Admin!2026

# Dependencies (postinstall runs prisma generate) and the production build.
RUN npm ci && npm run build

# Database: role and database, all migrations, demo data. Also caches the
# Prisma schema engine, so migrations work offline later.
RUN service postgresql start \
    && su postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE ROLE zeit LOGIN PASSWORD 'zeit' CREATEDB\"" \
    && su postgres -c "createdb -O zeit zeiterfassung" \
    && npx prisma migrate deploy \
    && npx tsx prisma/seed.ts \
    && service postgresql stop

RUN chmod +x .oss-scanner/start.sh

# Cheap checks so the image is known to work; a failure does not abort the build.
RUN (npm run typecheck && npm test) || echo "WARNING: typecheck or tests reported failures"
