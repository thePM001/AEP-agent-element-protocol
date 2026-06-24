package cli

import (
	"os"

	"github.com/nla-aep/aep-caw-framework/internal/client"
	"github.com/nla-aep/aep-caw-framework/pkg/types"
	"github.com/spf13/cobra"
)

func newRunCmd() *cobra.Command {
	var profile string
	var policy string
	var workspace string
	cmd := &cobra.Command{
		Use:   "run [command...]",
		Short: "Create a governed session and execute a command",
		Long:  "Creates a CAW session (optionally with a GAP mount profile) and runs the given command.",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := getClientConfig(cmd)
			c, err := client.NewForCLI(client.CLIOptions{HTTPBaseURL: cfg.serverAddr, GRPCAddr: cfg.grpcAddr, APIKey: cfg.apiKey, Transport: cfg.transport})
			if err != nil {
				return err
			}

			req := types.CreateSessionRequest{
				Workspace: workspace,
				Policy:    policy,
				Profile:   profile,
				Home:      userHomeDir(),
			}
			s, err := c.CreateSessionWithRequest(cmd.Context(), req)
			if err != nil {
				return err
			}

			execReq := types.ExecRequest{
				Command:    args[0],
				Args:       args[1:],
				WorkingDir: "/workspace",
			}
			resp, err := c.Exec(cmd.Context(), s.ID, execReq)
			if err != nil {
				return err
			}
			if len(resp.Result.Stdout) > 0 {
				_, _ = os.Stdout.WriteString(resp.Result.Stdout)
			}
			if len(resp.Result.Stderr) > 0 {
				_, _ = os.Stderr.WriteString(resp.Result.Stderr)
			}
			if resp.Result.ExitCode != 0 {
				return &execExitError{code: resp.Result.ExitCode}
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&profile, "profile", "", "GAP mount profile (e.g. coding-agent, agent-sandbox)")
	cmd.Flags().StringVar(&policy, "policy", "default", "Base policy when --profile is unset")
	cmd.Flags().StringVar(&workspace, "workspace", ".", "Workspace directory")
	return cmd
}

type execExitError struct {
	code int
}

func (e *execExitError) Error() string {
	return "command exited with non-zero status"
}

func (e *execExitError) ExitCode() int {
	return e.code
}