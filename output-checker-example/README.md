# Example: Agent Output Checker

A minimal reference implementation showing how to validate agent tool outputs
against customizable policy rules. This is an educational example - not a
production system.

## What It Does

After every tool call, an agent produces output. This example shows how to:

1. Run simple checks against that output (text patterns, forbidden words)
2. Log any issues to a report file
3. Keep a running tally of what was found

## How It Works

```
Agent produces output
       │
       ▼
  output_checker.py scan <output_text>
       │
       ├── check_text_colors()     ← example: low-contrast text
       ├── check_forbidden_chars() ← example: unwanted unicode
       ├── check_word_list()       ← example: banned terms
       └── check_url_patterns()    ← example: internal URL leaks
       │
       ▼
  report.txt  ←  appends findings with timestamp and agent ID
```

## Files

| File | Purpose |
|------|---------|
| `standards.py` | Example policy rules defined as Python check functions |
| `output_checker.py` | CLI tool: runs checks and writes reports |
| `check_config.yaml` | User-customizable config (word lists, URL patterns) |

## Quick Start

```bash
# Run a check against some text
echo "Some output with -- weird chars" | python3 output_checker.py scan

# Check a file
python3 output_checker.py scan < build.log

# View the report
cat report.txt
```

## Customization

Edit `check_config.yaml` to add your own rules:

```yaml
checks:
  forbidden_chars: [0x2014, 0x2013]     # em-dash, en-dash
  banned_words: [word1, word2]           # your forbidden terms
  url_patterns: [staging.example.com]    # your internal URLs
  min_text_brightness: 0.88              # minimum contrast ratio
```

## Example Report Entry

```
[2026-01-01T00:00:00Z] agent=demo-agent session=abc123 tool=write_file
  ISSUE: forbidden_char U+2014 at line 42: "text -- more"
  ISSUE: low_contrast at line 15: "color: rgba(240,240,240,0.5)"
```

## License

Apache 2.0 - use, modify, distribute freely.
