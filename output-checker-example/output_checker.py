#!/usr/bin/env python3
"""
Example: Agent Output Checker

A minimal reference implementation for validating agent tool outputs
against customizable policy rules. Reads from stdin, runs all checks,
appends findings to a report file.

Usage:
  echo "some agent output" | python3 output_checker.py scan
  python3 output_checker.py scan < build.log
  python3 output_checker.py scan --agent my-agent --tool write_file < output.txt

This is EXAMPLE code - customize check functions in standards.py
and rules in check_config.yaml for your own policies.
"""

import sys
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from standards import CHECKS

REPORT_FILE = Path("report.txt")


def run_all_checks(text: str) -> list:
    """Run all registered check functions and return list of issues."""
    all_issues = []
    for name, check_fn in CHECKS.items():
        try:
            issues = check_fn(text)
            for issue in issues:
                issue["check_name"] = name
            all_issues.extend(issues)
        except Exception as e:
            all_issues.append({
                "check_name": name,
                "check": "check_error",
                "detail": str(e)[:200],
            })
    return all_issues


def write_report(agent: str, session_id: str, tool: str, issues: list):
    """Append issues to the report file."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    entry_id = str(uuid.uuid4())[:8]

    lines = [f"[{timestamp}] agent={agent} session={session_id} tool={tool} id={entry_id}"]
    if not issues:
        lines.append("  OK - no issues found")
    else:
        for issue in issues:
            lines.append(
                f"  ISSUE: {issue['check']} {issue.get('detail','')} "
                f"at line {issue.get('line','?')}: {issue.get('snippet','')[:80]}"
            )

    with open(REPORT_FILE, "a") as f:
        f.write("\n".join(lines) + "\n")

    return entry_id, len(issues)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Agent Output Checker (example)")
    parser.add_argument("command", choices=["scan"], help="Run checks")
    parser.add_argument("--agent", default="demo-agent", help="Agent name")
    parser.add_argument("--session", default="demo-session", help="Session ID")
    parser.add_argument("--tool", default="unknown", help="Tool that produced output")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    if args.command == "scan":
        text = sys.stdin.read()
        issues = run_all_checks(text)
        entry_id, count = write_report(args.agent, args.session, args.tool, issues)

        if args.json:
            print(json.dumps({
                "entry_id": entry_id,
                "issue_count": count,
                "issues": issues,
            }, indent=2))
        else:
            if count == 0:
                print(f"OK - no issues found (report entry: {entry_id})")
            else:
                print(f"Found {count} issue(s) (report entry: {entry_id})")
                for issue in issues:
                    print(f"  [{issue['check']}] {issue.get('detail','')} "
                          f"line {issue.get('line','?')}")


if __name__ == "__main__":
    main()
