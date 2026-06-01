#!/usr/bin/env python3
"""
Example: Central Agent Error Registry CLI

A reference implementation for an agent error registry where autonomous
agents report their own policy violations. Reads agent output from stdin,
runs policy checks, and registers findings in a queryable JSON registry.

Usage:
  echo "agent output" | python3 registry_cli.py report --agent my-agent
  python3 registry_cli.py query --agent my-agent
  python3 registry_cli.py query --agent my-agent --check banned_word
  python3 registry_cli.py query --since 2026-01-01
  python3 registry_cli.py query --summary

This is EXAMPLE code - customize policy_checks.py and registry_config.yaml.
"""

import sys
import json
import uuid
import argparse
from datetime import datetime, timezone
from pathlib import Path

from policy_checks import CHECKS

REGISTRY_FILE = Path("registry.json")


def load_registry() -> dict:
    """Load existing registry entries."""
    if REGISTRY_FILE.exists():
        with open(REGISTRY_FILE) as f:
            return json.load(f)
    return {"entries": []}


def save_registry(registry: dict):
    """Save registry to disk."""
    with open(REGISTRY_FILE, "w") as f:
        json.dump(registry, f, indent=2)


def run_all_checks(text: str) -> list:
    """Run all registered check functions and return findings."""
    all_findings = []
    for name, check_fn in CHECKS.items():
        try:
            findings = check_fn(text)
            for finding in findings:
                finding["check_name"] = name
            all_findings.extend(findings)
        except Exception as e:
            all_findings.append({
                "check_name": name,
                "check": "check_error",
                "detail": str(e)[:200],
            })
    return all_findings


def cmd_report(args):
    """Register findings from agent output."""
    text = sys.stdin.read()

    if not text.strip():
        print("No input received. Pipe agent output to this command.")
        sys.exit(1)

    findings = run_all_checks(text)
    entry_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    entry = {
        "entry_id": entry_id,
        "agent": args.agent,
        "session": args.session,
        "tool": args.tool,
        "timestamp": timestamp,
        "finding_count": len(findings),
        "findings": findings,
    }

    registry = load_registry()
    registry["entries"].append(entry)
    save_registry(registry)

    if findings:
        print(f"Registered {len(findings)} finding(s) from {args.agent} "
              f"(entry: {entry_id})")
        for f in findings:
            print(f"  [{f.get('check','?')}] {f.get('detail','')} "
                  f"line {f.get('line','?')}")
    else:
        print(f"No findings from {args.agent} (entry: {entry_id})")


def cmd_query(args):
    """Query the registry for findings."""
    registry = load_registry()
    entries = registry.get("entries", [])

    # Filters
    if args.agent:
        entries = [e for e in entries if e.get("agent") == args.agent]
    if args.session:
        entries = [e for e in entries if e.get("session") == args.session]
    if args.check:
        entries = [
            e for e in entries
            if any(f.get("check") == args.check for f in e.get("findings", []))
        ]
    if args.since:
        entries = [e for e in entries if e.get("timestamp", "") >= args.since]

    if args.summary:
        print(f"Total entries: {len(entries)}")
        agents = {}
        for e in entries:
            agent = e.get("agent", "unknown")
            agents[agent] = agents.get(agent, 0) + e.get("finding_count", 0)
        for agent, count in sorted(agents.items()):
            print(f"  {agent}: {count} finding(s)")
        return

    print(json.dumps(entries, indent=2))


def main():
    parser = argparse.ArgumentParser(
        description="Central Agent Error Registry (example)"
    )
    sub = parser.add_subparsers(dest="command")

    # report
    p_report = sub.add_parser("report", help="Register findings from stdin")
    p_report.add_argument("--agent", default="demo-agent", help="Agent name")
    p_report.add_argument("--session", default="demo-session", help="Session ID")
    p_report.add_argument("--tool", default="unknown", help="Tool name")

    # query
    p_query = sub.add_parser("query", help="Query the registry")
    p_query.add_argument("--agent", help="Filter by agent name")
    p_query.add_argument("--session", help="Filter by session ID")
    p_query.add_argument("--check", help="Filter by check type")
    p_query.add_argument("--since", help="Filter by date (YYYY-MM-DD)")
    p_query.add_argument("--summary", action="store_true", help="Summary only")

    args = parser.parse_args()

    if args.command == "report":
        cmd_report(args)
    elif args.command == "query":
        cmd_query(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
