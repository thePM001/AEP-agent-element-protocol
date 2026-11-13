package shellparse

import (
	"reflect"
	"testing"
)

// TestPlainCommand covers the strict single-command acceptor used by the
// shell shim to decide whether a command line may skip the shell. Only
// exactly [-c, script] with a cleanly tokenized external command is
// accepted; every chaining, substitution, redirection or wrapper form must
// be rejected.
func TestPlainCommand(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		wantArgv []string
		wantOK   bool
	}{
		// Accepted plain commands.
		{"plain version", []string{"-c", "aep-caw version"}, []string{"aep-caw", "version"}, true},
		{"detect json", []string{"-c", "aep-caw detect --json"}, []string{"aep-caw", "detect", "--json"}, true},
		{"single quoted arg", []string{"-c", "aep-caw debug policy-test 'rm -rf /'"}, []string{"aep-caw", "debug", "policy-test", "rm -rf /"}, true},
		{"double quoted arg", []string{"-c", `aep-caw trash list "a b; c"`}, []string{"aep-caw", "trash", "list", "a b; c"}, true},
		{"concatenated quotes", []string{"-c", `aep-caw x'y'"z"`}, []string{"aep-caw", "xyz"}, true},
		{"absolute path", []string{"-c", "/usr/local/bin/aep-caw detect"}, []string{"/usr/local/bin/aep-caw", "detect"}, true},
		{"extra blanks", []string{"-c", "  aep-caw \t version  "}, []string{"aep-caw", "version"}, true},
		{"empty quoted arg", []string{"-c", "aep-caw ''"}, []string{"aep-caw", ""}, true},

		// Command chaining and substitution.
		{"single ampersand", []string{"-c", "aep-caw version & id"}, nil, false},
		{"trailing ampersand", []string{"-c", "aep-caw version &"}, nil, false},
		{"process substitution in", []string{"-c", "aep-caw version <(id)"}, nil, false},
		{"process substitution out", []string{"-c", "aep-caw version >(id)"}, nil, false},
		{"semicolon", []string{"-c", "aep-caw version; id"}, nil, false},
		{"and chain", []string{"-c", "aep-caw version && id"}, nil, false},
		{"or chain", []string{"-c", "aep-caw version || id"}, nil, false},
		{"pipe", []string{"-c", "aep-caw version | id"}, nil, false},
		{"newline", []string{"-c", "aep-caw version\nid"}, nil, false},
		{"carriage return", []string{"-c", "aep-caw version\rid"}, nil, false},
		{"command substitution", []string{"-c", "aep-caw $(id)"}, nil, false},
		{"command substitution head", []string{"-c", "$(aep-caw version)"}, nil, false},
		{"backticks", []string{"-c", "aep-caw `id`"}, nil, false},
		{"expansion in double quotes", []string{"-c", `aep-caw "$(id)"`}, nil, false},
		{"backtick in double quotes", []string{"-c", "aep-caw \"`id`\""}, nil, false},
		{"parameter expansion", []string{"-c", "aep-caw $HOME"}, nil, false},
		{"subshell", []string{"-c", "(aep-caw version)"}, nil, false},
		{"brace group", []string{"-c", "{ aep-caw version; }"}, nil, false},
		{"glob", []string{"-c", "aep-caw *"}, nil, false},
		{"tilde", []string{"-c", "aep-caw ~"}, nil, false},
		{"comment", []string{"-c", "aep-caw version #x"}, nil, false},
		{"escape", []string{"-c", `aep-caw version\ x`}, nil, false},

		// Redirections.
		{"stderr to stdout", []string{"-c", "aep-caw version 2>&1"}, nil, false},
		{"stdout to file", []string{"-c", "aep-caw version > /dev/null"}, nil, false},
		{"stdin from file", []string{"-c", "aep-caw version < /etc/passwd"}, nil, false},

		// Assignments, wrappers and builtins.
		{"env assignment", []string{"-c", "PATH=/tmp aep-caw version"}, nil, false},
		{"env assignment only", []string{"-c", "FOO=1"}, nil, false},
		{"exec prefix", []string{"-c", "exec aep-caw version"}, nil, false},
		{"nice prefix", []string{"-c", "nice aep-caw version"}, nil, false},
		{"nohup prefix", []string{"-c", "nohup aep-caw version"}, nil, false},
		{"command prefix", []string{"-c", "command aep-caw version"}, nil, false},
		{"env prefix", []string{"-c", "env aep-caw version"}, nil, false},
		{"time prefix", []string{"-c", "time aep-caw version"}, nil, false},
		{"builtin eval", []string{"-c", "eval aep-caw"}, nil, false},
		{"builtin source", []string{"-c", "source x"}, nil, false},
		{"dot builtin", []string{"-c", ". x"}, nil, false},
		{"reserved word", []string{"-c", "if aep-caw"}, nil, false},
		{"quoted builtin", []string{"-c", "'eval' aep-caw"}, nil, false},
		{"empty command word", []string{"-c", "'' aep-caw"}, nil, false},

		// Quoting errors and empty scripts.
		{"unterminated single quote", []string{"-c", "aep-caw 'version"}, nil, false},
		{"unterminated double quote", []string{"-c", `aep-caw "version`}, nil, false},
		{"empty script", []string{"-c", ""}, nil, false},
		{"blank script", []string{"-c", "  \t "}, nil, false},

		// Argument shape.
		{"extra positional arg", []string{"-c", "aep-caw version", "sh"}, nil, false},
		{"two extra positional args", []string{"-c", "aep-caw version", "sh", "x"}, nil, false},
		{"login cluster", []string{"-lc", "aep-caw version"}, nil, false},
		{"errexit cluster", []string{"-ec", "aep-caw version"}, nil, false},
		{"split login flag", []string{"-l", "-c", "aep-caw version"}, nil, false},
		{"long option", []string{"--norc", "-c", "aep-caw version"}, nil, false},
		{"script file", []string{"script.sh", "-c", "aep-caw version"}, nil, false},
		{"no -c", []string{"aep-caw", "version"}, nil, false},
		{"just -c", []string{"-c"}, nil, false},
		{"no args", []string{}, nil, false},
		{"nil args", nil, nil, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			argv, ok := PlainCommand(tt.args)
			if ok != tt.wantOK {
				t.Fatalf("PlainCommand(%q) ok = %v, want %v (argv %q)", tt.args, ok, tt.wantOK, argv)
			}
			if !reflect.DeepEqual(argv, tt.wantArgv) {
				t.Fatalf("PlainCommand(%q) argv = %q, want %q", tt.args, argv, tt.wantArgv)
			}
		})
	}
}
