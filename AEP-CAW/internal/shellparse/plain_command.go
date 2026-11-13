package shellparse

// PlainCommand reports the argv of a shell invocation that is exactly one
// plain external command, so a caller can start that command directly
// without a shell.
//
// It accepts ONLY shellArgs of the exact form [-c, script]: no other shell
// flags (clustered or separate) and no positional parameters after the
// script. The script must:
//   - have no leading NAME=VALUE environment assignments;
//   - tokenize cleanly with tokenizeSimpleScript, so every unquoted byte is
//     in [A-Za-z0-9_./-] or a blank, and quoted spans hold no expansion.
//     This rejects every command separator and chaining operator (; & && ||
//     | newline), every substitution ($(...) backticks <(...) >(...)),
//     redirections (2>&1, > file, < file), globs, comments and escapes;
//   - start with a non-empty word that is neither a transparent wrapper
//     (exec, command, nohup, nice, time, env) nor a shell builtin or
//     reserved word.
//
// On success argv holds the command word followed by its arguments, with
// quotes removed exactly as the shell would. Any other input returns
// (nil, false). The check is intentionally strict: a false return only
// means the caller must take its normal (enforced) path.
func PlainCommand(shellArgs []string) (argv []string, ok bool) {
	if len(shellArgs) != 2 || shellArgs[0] != "-c" {
		return nil, false
	}
	script := shellArgs[1]
	if rest, dirty := stripLeadingAssignments(script); dirty || rest != script {
		return nil, false
	}
	tokens, opaque := tokenizeSimpleScript(script)
	if opaque || len(tokens) == 0 {
		return nil, false
	}
	head := tokens[0]
	if head == "" || isTransparentWrapper(head) || isShellBuiltin(head) {
		return nil, false
	}
	return tokens, true
}
