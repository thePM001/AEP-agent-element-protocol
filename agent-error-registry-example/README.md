# Example: Central Agent Error Registry

A minimal reference implementation showing how to build a central registry
where autonomous agents report their own policy violations. This is an
educational example - not a production system.

## Concept

Autonomous agents make mistakes. A central error registry gives you one place
where every agent reports what it did wrong. Instead of digging through logs
across multiple agent sessions, you query one registry.

## How It Works

```
Agent produces output
       │
       ▼
  registry_cli.py report <output_text>
       │
       ├── check_text_colors()     ← example: low-contrast text
       ├── check_forbidden_chars() ← example: unwanted unicode
       ├── check_word_list()       ← example: banned terms
       └── check_url_patterns()    ← example: internal URL leaks
       │
       ▼
  registry.json  ←  all findings in one place, queryable
```

## What Gets Registered

Each entry records: who (agent ID), when (timestamp), what tool produced the
output, and which specific rules were broken with the exact text and location.

## Files

| File | Purpose |
|------|---------|
| `registry_cli.py` | CLI tool: scans agent output, registers findings |
| `policy_checks.py` | Example policy rules as Python check functions |
| `registry_config.yaml` | User-customizable config (word lists, URL patterns) |

## Quick Start

```bash
# Register findings from agent output
echo "Some agent output with -- issues" | python3 registry_cli.py report --agent my-agent

# Query the registry
python3 registry_cli.py query --agent my-agent

# Query with filters
python3 registry_cli.py query --agent my-agent --check banned_word --since 2026-01-01
```

## Customization

Edit `registry_config.yaml` to define your own rules:

```yaml
registry:
  storage: registry.json
  
checks:
  forbidden_chars: [0x2014, 0x2013]
  banned_words: [word1, word2]
  url_patterns: [staging.example.com]
  min_text_brightness: 0.88
```

## Example Registry Entry

```json
{
  "agent": "demo-agent",
  "session": "abc123",
  "tool": "write_file",
  "timestamp": "2026-01-01T00:00:00Z",
  "findings": [
    {
      "check": "forbidden_char",
      "detail": "U+2014 at line 42",
      "fix": "Replace with ' - '"
    }
  ]
}
```

## License

Apache 2.0 - use, modify, distribute freely.
