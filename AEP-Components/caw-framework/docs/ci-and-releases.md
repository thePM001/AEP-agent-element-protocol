# CI and Releases (Plan)

## CI (feature branches + main)

Goals:
- Catch regressions early: `go test ./...` + `make smoke`
- Keep it fast and deterministic

Implementation:
- GitHub Actions workflow on:
  - `pull_request` (feature branches)
  - `push` to `main`
- Cache the repo-local Go caches used by `Makefile` / `scripts/smoke.sh`:
  - `.gocache`, `.gomodcache`, `.gopath`

Current workflow:
- `.github/workflows/ci.yml`

## Releases (tags)

Desired outputs:
- Archives (at minimum): `.tar.gz` for Linux/macOS with:
  - `aep-caw`
  - `aep-caw-shell-shim`
- OS packages:
  - Debian/Ubuntu: `.deb`
  - RHEL/Fedora: `.rpm`
  - Alpine: `.apk` (requires a musl-compatible binary; `CGO_ENABLED=0` static Go builds should be fine)

Suggested approach: GoReleaser + nfpm
- Use GoReleaser to:
  - Build `aep-caw` and `aep-caw-shell-shim` per target
  - Produce `.tar.gz` archives
  - Produce `.deb/.rpm/.apk` via nfpm (no postinst actions at first; packages should not automatically replace `/bin/sh`)

Workflow shape:
1) `push` tags `v*` triggers a `release.yml` workflow
2) Build matrix for `linux/amd64`, `linux/arm64` (and optionally `darwin/amd64`, `darwin/arm64`)
3) Upload artifacts to the GitHub Release

Current files:
- `.github/workflows/release.yml`
- `.goreleaser.yml`

Open decisions before implementing packages:
- Install locations:
  - likely `/usr/bin/aep-caw` and `/usr/bin/aep-caw-shell-shim`
- Configuration:
  - ship a sample config under `/etc/aep-caw/` (or only in the repo)
- Services:
  - whether to ship a systemd unit (probably later)
- Shim activation:
  - do *not* auto-replace `/bin/sh` in packages; provide `aep-caw shim install-shell --root /` with explicit `--i-understand-this-modifies-the-host`
  - for non-interactive enforcement (e.g., sandbox platforms), add `--force` which writes `/etc/aep-caw/shim.conf` with `force=true`
