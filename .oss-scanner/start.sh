#!/bin/sh
# Start PostgreSQL and the built app on http://localhost:3000 inside the
# OSS Scanner image (see .oss-scanner/Dockerfile and threat_model.md).
set -e
service postgresql start >/dev/null
cd /src
exec npx next start -p "${PORT:-3000}"
