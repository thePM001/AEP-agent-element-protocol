package cli

import (
	"fmt"

	"github.com/nla-aep/aep-caw-framework/internal/client"
	"github.com/spf13/cobra"
)

func newProfilesCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "profiles",
		Short: "List GAP-compiled mount profiles",
	}
	cmd.AddCommand(newProfilesListCmd())
	return cmd
}

func newProfilesListCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List available mount profiles from CAW server config",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg := getClientConfig(cmd)
			c, err := client.NewForCLI(client.CLIOptions{HTTPBaseURL: cfg.serverAddr, GRPCAddr: cfg.grpcAddr, APIKey: cfg.apiKey, Transport: cfg.transport})
			if err != nil {
				return err
			}
			resp, err := c.ListProfiles(cmd.Context())
			if err != nil {
				return err
			}
			if len(resp.Profiles) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "no mount profiles configured (compile from AEP-Components/gap/policies/reference/)")
				return nil
			}
			return printJSON(cmd, resp)
		},
	}
	return cmd
}