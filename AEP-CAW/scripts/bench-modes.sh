#!/usr/bin/env bash
# Build and run the aep-caw performance benchmark.
# Compares baseline vs full mode (seccomp+FUSE) vs seccomp-notify vs ptrace.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

echo "bench: building image..."
docker build -f Dockerfile.bench -t aep-caw-bench:latest .

echo "bench: running benchmark..."
docker run --rm \
  --cap-add SYS_ADMIN --cap-add SYS_PTRACE \
  --device /dev/fuse \
  --security-opt seccomp=unconfined \
  aep-caw-bench:latest
