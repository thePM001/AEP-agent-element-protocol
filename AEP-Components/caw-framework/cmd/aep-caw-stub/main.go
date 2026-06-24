package main

import (
	"fmt"
	"net"
	"os"
	"strconv"

	"github.com/nla-aep/aep-caw-framework/internal/stub"
)

// wellKnownStubFD is the fd number injected by the seccomp redirect handler.
// When aep-caw-stub is exec'd via memory rewrite redirect, AEP_CAW_STUB_FD
// is not in the environment - the stub must discover the socket by probing
// this well-known fd number.
const wellKnownStubFD = 100

func main() {
	os.Exit(run())
}

func run() int {
	// Check for named pipe first (Windows)
	pipeName := os.Getenv("AEP_CAW_STUB_PIPE")
	if pipeName != "" {
		code := runWithPipe(pipeName)
		if code >= 0 {
			return code
		}
		// Negative return means pipe not supported on this platform; fall through to fd
	}

	// Check for explicit fd env var (Unix)
	fdStr := os.Getenv("AEP_CAW_STUB_FD")
	if fdStr != "" {
		return runWithFD(fdStr)
	}

	// Try well-known fd 100 (redirect-injected socket)
	if probeSocket(wellKnownStubFD) {
		return runWithFD(strconv.Itoa(wellKnownStubFD))
	}

	// Nothing worked - report error
	if pipeName != "" {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: pipe transport not supported on this platform and AEP_CAW_STUB_FD not set\n")
	} else {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: neither AEP_CAW_STUB_PIPE nor AEP_CAW_STUB_FD set\n")
	}
	return 126
}

// runWithFD converts a string fd number to a net.Conn and runs the stub proxy.
func runWithFD(fdStr string) int {
	fd, err := strconv.Atoi(fdStr)
	if err != nil || fd < 0 {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: invalid fd: %s\n", fdStr)
		return 126
	}

	f := os.NewFile(uintptr(fd), "aep-caw-stub-socket")
	if f == nil {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: failed to open fd %d\n", fd)
		return 126
	}

	conn, err := net.FileConn(f)
	f.Close()
	if err != nil {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: failed to create connection from fd %d: %v\n", fd, err)
		return 126
	}
	defer conn.Close()

	exitCode, err := stub.RunProxy(conn, os.Stdin, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: proxy error: %v\n", err)
		return 126
	}

	return exitCode
}
