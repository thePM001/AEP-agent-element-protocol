//go:build windows

package main

import (
	"fmt"
	"os"
	"time"

	winio "github.com/Microsoft/go-winio"
	"github.com/nla-aep/aep-caw-framework/internal/stub"
)

func runWithPipe(pipeName string) int {
	timeout := 5 * time.Second
	conn, err := winio.DialPipe(pipeName, &timeout)
	if err != nil {
		fmt.Fprintf(os.Stderr, "aep-caw-stub: failed to connect to pipe %s: %v\n", pipeName, err)
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
