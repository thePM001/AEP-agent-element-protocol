# Homebrew Cask Distribution for macOS AepCaw

## Summary

Distribute the signed, notarized `AepCaw.app` via Homebrew Cask so users can install with `brew tap canyonroad/tap && brew install --cask aep-caw`. The release pipeline auto-generates and pushes the cask formula on each stable release.

## Motivation

The macOS build produces a signed, notarized DMG containing `AepCaw.app` with its system extension, XPC service, and approval dialog. Without the full app bundle, the ESF file/process interception and network filtering don't work. Homebrew Cask is the standard macOS mechanism for distributing `.app` bundles, and users expect `brew install` to work.

## Design

### Tap Repository

Create `canyonroad/homebrew-tap` on GitHub with this structure:

```
homebrew-tap/
  Casks/
    aep-caw.rb        # Auto-generated on each stable release
  README.md
```

Users install with:

```bash
brew tap canyonroad/tap
brew install --cask aep-caw
```

### Cask Formula

The cask formula installs `AepCaw.app` from the release DMG:

```ruby
cask "aep-caw" do
  version "0.16.11"
  sha256 "abc123..."

  url "https://github.com/canyonroad/aep-caw/releases/download/v#{version}/AepCaw-v#{version}.dmg"
  name "AepCaw"
  desc "Secure sandboxed shell for AI agents"
  homepage "https://github.com/canyonroad/aep-caw"

  depends_on macos: ">= :sonoma"

  app "AepCaw.app"

  uninstall quit:      "ai.canyonroad.aep-caw",
            signal:    ["TERM", "aep-caw"],
            launchctl: "ai.canyonroad.aep-caw.daemon"

  zap trash: [
    "~/Library/Application Support/aep-caw",
    "~/Library/Preferences/ai.canyonroad.aep-caw.plist",
    "~/Library/Caches/ai.canyonroad.aep-caw",
    "~/Library/LaunchAgents/ai.canyonroad.aep-caw.daemon.plist",
  ]

  caveats <<~EOS
    After installation, open AepCaw.app to activate the system extension:
      open /Applications/AepCaw.app
    You will be prompted in System Settings to approve the extension.
  EOS
end
```

Key decisions:
- `depends_on macos: ">= :sonoma"` matches the deployment target (macOS 14.0)
- Uses `caveats` instead of `postflight` to guide the user through system extension approval (compatible with official homebrew-cask submission)
- `uninstall` quits the app, signals the `aep-caw` server process, and unloads the launchd daemon
- `zap` cleans up preferences, caches, application support data, and the launchd plist

### Cask Template

A template file lives in the main aep-caw repo at `scripts/homebrew-cask.rb.tmpl`. The release pipeline substitutes `__VERSION__` and `__SHA256__` placeholders:

```ruby
cask "aep-caw" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/canyonroad/aep-caw/releases/download/v#{version}/AepCaw-v#{version}.dmg"
  # ... rest of formula
end
```

This keeps the formula structure under code review in the main repo.

### Release Pipeline

A new job `publish-homebrew-cask` in `.github/workflows/release.yml`:

```yaml
publish-homebrew-cask:
  runs-on: ubuntu-latest
  needs: [build-macos-app]
  if: "!contains(github.ref_name, '-')"
  steps:
    - uses: actions/checkout@v4

    - name: Download DMG and compute SHA256
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        VERSION: ${{ github.ref_name }}
      run: |
        gh release download "$VERSION" \
          --pattern "AepCaw-*.dmg" \
          --repo "${{ github.repository }}" \
          --dir .
        DMG_FILE=$(ls AepCaw-*.dmg)
        if [ "$(echo "$DMG_FILE" | wc -l)" -ne 1 ]; then
          echo "::error::Expected exactly one DMG file, found: $DMG_FILE"
          exit 1
        fi
        SHA256=$(sha256sum "$DMG_FILE" | awk '{print $1}')
        echo "SHA256=$SHA256" >> "$GITHUB_ENV"
        echo "CLEAN_VERSION=${VERSION#v}" >> "$GITHUB_ENV"

    - name: Generate cask formula
      run: |
        sed -e "s/__VERSION__/$CLEAN_VERSION/g" \
            -e "s/__SHA256__/$SHA256/g" \
            scripts/homebrew-cask.rb.tmpl > aep-caw.rb

    - name: Push to homebrew-tap
      env:
        TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_GITHUB_TOKEN }}
      run: |
        git clone "https://x-access-token:${TAP_TOKEN}@github.com/canyonroad/homebrew-tap.git" tap
        mkdir -p tap/Casks
        cp aep-caw.rb tap/Casks/aep-caw.rb
        cd tap
        git config user.name "github-actions[bot]"
        git config user.email "github-actions[bot]@users.noreply.github.com"
        git add Casks/aep-caw.rb
        git diff --cached --quiet || git commit -m "Update aep-caw cask to ${CLEAN_VERSION}"
        git push
```

The job:
1. Only runs on stable releases (tag does not contain `-`)
2. Downloads the DMG from the GitHub release
3. Computes the SHA256
4. Generates the cask formula from the template
5. Pushes to `canyonroad/homebrew-tap`

Required secret: `HOMEBREW_TAP_GITHUB_TOKEN` - a PAT with `repo` scope (or fine-grained `contents: write`) on `canyonroad/homebrew-tap`.

### GoReleaser Cleanup

Remove the existing disabled `homebrew_casks` section from `.goreleaser.yml` and replace with a comment:

```yaml
# Homebrew cask is published by the publish-homebrew-cask job in release.yml
# (not managed by GoReleaser - the cask installs the signed DMG, not raw binaries)
```

### Future: Official Homebrew Submission

The cask formula is designed to be compatible with `homebrew/homebrew-cask` submission requirements:
- Standard `app` stanza
- Proper `uninstall` and `zap` stanzas
- SHA256 verification
- Stable versioned URL

When ready to submit officially, the formula can be adapted with minimal changes.

## Out of Scope

- Linux/Windows Homebrew (Linuxbrew) - not applicable for the `.app` bundle
- Auto-update mechanism within the app - Homebrew handles upgrades via `brew upgrade --cask aep-caw`
- CLI-only formula for non-macOS platforms - could be added later as a separate Formula
