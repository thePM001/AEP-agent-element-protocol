.PHONY: build build-shim test lint clean proto ebpf
.PHONY: smoke ptrace-test dns-test seccomp-probe bench
.PHONY: completions package-snapshot package-release
.PHONY: build-macos-enterprise build-macos-go build-swift assemble-bundle sign-bundle
.PHONY: build-driver build-driver-debug install-driver uninstall-driver build-windows-full
.PHONY: build-macwrap
.PHONY: build-approval-dialog-windows

VERSION := $(shell git describe --tags --abbrev=0 2>/dev/null || echo dev)
COMMIT := $(shell git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)
LDFLAGS := -ldflags "-X main.version=$(VERSION) -X main.commit=$(COMMIT)"

GOCACHE ?= $(CURDIR)/.gocache
GOMODCACHE ?= $(CURDIR)/.gomodcache
GOPATH ?= $(CURDIR)/.gopath

build:
	mkdir -p bin $(GOCACHE) $(GOMODCACHE) $(GOPATH)
	GOCACHE=$(GOCACHE) GOMODCACHE=$(GOMODCACHE) GOPATH=$(GOPATH) go build $(LDFLAGS) -o bin/aep-caw ./cmd/aep-caw
	GOCACHE=$(GOCACHE) GOMODCACHE=$(GOMODCACHE) GOPATH=$(GOPATH) go build $(LDFLAGS) -o bin/aep-caw-shell-shim ./cmd/aep-caw-shell-shim
	GOCACHE=$(GOCACHE) GOMODCACHE=$(GOMODCACHE) GOPATH=$(GOPATH) go build $(LDFLAGS) -o bin/aep-caw-unixwrap ./cmd/aep-caw-unixwrap

build-shim:
	mkdir -p bin $(GOCACHE) $(GOMODCACHE) $(GOPATH)
	GOCACHE=$(GOCACHE) GOMODCACHE=$(GOMODCACHE) GOPATH=$(GOPATH) go build $(LDFLAGS) -o bin/aep-caw-shell-shim ./cmd/aep-caw-shell-shim

# Build macwrap (requires macOS with Xcode - uses cgo for darwin-specific code)
build-macwrap:
	mkdir -p bin $(GOCACHE) $(GOMODCACHE) $(GOPATH)
	GOOS=darwin CGO_ENABLED=1 GOCACHE=$(GOCACHE) GOMODCACHE=$(GOMODCACHE) GOPATH=$(GOPATH) go build $(LDFLAGS) -o bin/aep-caw-macwrap ./cmd/aep-caw-macwrap

proto:
	protoc -I proto \
	  --go_out=. --go_opt=module=github.com/nla-aep/aep-caw-framework \
	  --go-grpc_out=. --go-grpc_opt=module=github.com/nla-aep/aep-caw-framework \
	  proto/aepcaw/v1/pty.proto

test:
	mkdir -p $(GOCACHE) $(GOMODCACHE) $(GOPATH)
	GOCACHE=$(GOCACHE) GOMODCACHE=$(GOMODCACHE) GOPATH=$(GOPATH) go test ./...

smoke:
	bash scripts/smoke.sh

ptrace-test:
	docker build -f Dockerfile.ptrace-test -t aep-caw-ptrace-test .
	docker run --rm --cap-add SYS_PTRACE aep-caw-ptrace-test

dns-test:
	docker build -f Dockerfile.dns-test -t aep-caw-dns-test .
	docker run --rm --cap-add SYS_PTRACE aep-caw-dns-test

seccomp-probe:
	mkdir -p build
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o build/seccomp-probe ./cmd/seccomp-probe/

bench:
	bash scripts/bench-modes.sh

lint:
	@echo "No linter configured"

clean:
	rm -rf bin build coverage.out dist

# Rebuild eBPF objects from source (requires clang and Linux BTF headers)
ebpf:
	$(MAKE) -C internal/netmonitor/ebpf clean all

# Generate shell completions
completions: build
	mkdir -p packaging/completions
	bin/aep-caw completion bash > packaging/completions/aep-caw.bash
	bin/aep-caw completion zsh > packaging/completions/aep-caw.zsh
	bin/aep-caw completion fish > packaging/completions/aep-caw.fish

# Build packages locally using goreleaser (snapshot mode, no publish)
package-snapshot: completions
	goreleaser release --snapshot --clean --skip=publish

# Build release packages (requires GITHUB_TOKEN, usually run by CI)
package-release:
	goreleaser release --clean

# =============================================================================
# macOS Enterprise Build (System Extension + Network Extension)
# NOTE: build-swift, assemble-bundle, and sign-bundle require macOS with Xcode
# =============================================================================

# Build Go binary for macOS (CGO disabled for cross-compilation)
build-macos-go:
	mkdir -p build/AepCaw.app/Contents/MacOS
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build $(LDFLAGS) -o build/AepCaw.app/Contents/MacOS/aep-caw ./cmd/aep-caw

# Build Swift components via Xcode (requires macOS with Xcode)
build-swift:
	xcodebuild \
		-project macos/aep-caw/aep-caw.xcodeproj \
		-scheme aep-caw \
		-configuration Release \
		-derivedDataPath build/DerivedData \
		CODE_SIGN_IDENTITY="" \
		CODE_SIGNING_REQUIRED=NO \
		CODE_SIGNING_ALLOWED=NO

# Assemble app bundle
assemble-bundle: build-macos-go build-swift
	mkdir -p build/AepCaw.app/Contents/{Library/SystemExtensions,XPCServices,Resources}
	cp macos/AepCaw-files/Info.plist build/AepCaw.app/Contents/
	cp -R build/DerivedData/Build/Products/Release/SysExt.systemextension \
		build/AepCaw.app/Contents/Library/SystemExtensions/
	cp -R build/DerivedData/Build/Products/Release/xpc.xpc \
		build/AepCaw.app/Contents/XPCServices/
	cp -R build/DerivedData/Build/Products/Release/approval-dialog.app \
		build/AepCaw.app/Contents/Resources/

# Sign bundle (requires SIGNING_IDENTITY env var)
sign-bundle:
	for bin in build/AepCaw.app/Contents/MacOS/*; do \
		echo "Signing $$(basename $$bin)"; \
		codesign --force --sign "$(SIGNING_IDENTITY)" \
			--options runtime --timestamp \
			"$$bin"; \
	done
	codesign --force --sign "$(SIGNING_IDENTITY)" \
		--entitlements macos/aep-caw/SysExt.entitlements \
		--options runtime --timestamp \
		build/AepCaw.app/Contents/Library/SystemExtensions/SysExt.systemextension
	codesign --force --sign "$(SIGNING_IDENTITY)" \
		--options runtime --timestamp \
		build/AepCaw.app/Contents/XPCServices/xpc.xpc
	codesign --force --sign "$(SIGNING_IDENTITY)" \
		--entitlements macos/aep-caw/approval-dialog/approval-dialog.entitlements \
		--options runtime --timestamp \
		build/AepCaw.app/Contents/Resources/approval-dialog.app
	codesign --force --sign "$(SIGNING_IDENTITY)" \
		--entitlements macos/aep-caw/aep-caw/aep-caw.entitlements \
		--options runtime --timestamp \
		build/AepCaw.app
	codesign --verify --deep --strict --verbose=2 build/AepCaw.app

# Full enterprise build
build-macos-enterprise: assemble-bundle sign-bundle
	@echo "Enterprise build complete: build/AepCaw.app"

# =============================================================================
# Windows Driver Build (Minifilter)
# NOTE: These targets require Windows with WDK installed
# =============================================================================

# Build Windows driver (Release)
build-driver:
	@echo "Building Windows driver (Release)..."
	cd drivers/windows/aep-caw-minifilter && scripts/build.cmd Release x64

# Build Windows driver (Debug)
build-driver-debug:
	@echo "Building Windows driver (Debug)..."
	cd drivers/windows/aep-caw-minifilter && scripts/build.cmd Debug x64

# Install Windows driver
install-driver:
	@echo "Installing Windows driver..."
	cd drivers/windows/aep-caw-minifilter && scripts/install.cmd

# Uninstall Windows driver
uninstall-driver:
	@echo "Uninstalling Windows driver..."
	cd drivers/windows/aep-caw-minifilter && scripts/uninstall.cmd

# Build Windows ApprovalDialog (requires Windows with Visual Studio/MSBuild)
# MSBuild path varies by Visual Studio version. Override with:
#   make MSBUILD="path\to\MSBuild.exe" build-approval-dialog-windows
# Common paths:
#   VS 2022: C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe
#   VS 2019: C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\MSBuild\Current\Bin\MSBuild.exe
MSBUILD ?= MSBuild.exe

build-approval-dialog-windows:
	@echo "Building Windows ApprovalDialog..."
	mkdir -p build/windows
	$(MSBUILD) windows/ApprovalDialog/ApprovalDialog.csproj \
		-p:Configuration=Release \
		-p:OutputPath=$(CURDIR)/build/windows \
		-verbosity:minimal
	@echo "Windows ApprovalDialog built: build/windows/aep-caw-approval-dialog.exe"

# Full Windows build (Go + driver + ApprovalDialog)
build-windows-full: build-driver build-approval-dialog-windows
	mkdir -p bin
	GOOS=windows GOARCH=amd64 go build -o bin/aep-caw.exe ./cmd/aep-caw
	@echo "Windows build complete:"
	@echo "  - bin/aep-caw.exe"
	@echo "  - build/windows/aep-caw-approval-dialog.exe"
	@echo "  - drivers/windows/aep-caw-minifilter/..."
