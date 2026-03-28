---
name: release
description: Walk through pushing a new release -- suggest version, update changelog and package.json, provide push commands
user_invocable: true
---

# Release Skill

You are walking the user through cutting a new release of Chessstack.
Follow these steps in order. Do NOT skip ahead or make changes without confirmation.

## Step 1 -- Gather context

Run these commands and read CHANGELOG.md:

1. `git tag --sort=-v:refname | head -1` to get the latest release tag.
2. `git log <latest-tag>..HEAD --oneline` to see all commits since that tag.
3. Read `package.json` (just the first few lines) to confirm the current version field.
4. Read the `## [Unreleased]` section from `CHANGELOG.md`.

Present a summary to the user:

- **Last release**: vX.X.X
- **Current package.json version**: X.X.X
- **Commits since last release**: list them
- **Unreleased changelog entries**: show them

## Step 2 -- Suggest a version

Based on the unreleased changes, suggest a semver bump:

- **patch** (X.X.+1): only bug fixes, docs, or minor tweaks
- **minor** (X.+1.0): new features, non-breaking changes
- **major** (+1.0.0): breaking changes

State which bump you recommend and why. Ask the user to confirm or pick a different version.
Wait for their response before continuing.

## Step 3 -- Update files

Once the user confirms the version (vX.X.X):

1. **CHANGELOG.md**: Move everything under `## [Unreleased]` into a new `## [X.X.X] -- YYYY-MM-DD` section (use today's date). Leave `## [Unreleased]` empty (no subsections). Update the comparison links at the bottom:
   - Change `[Unreleased]` link to compare against the new tag
   - Add a new `[X.X.X]` link comparing against the previous tag
2. **package.json**: Update the `"version"` field to the new version.

After making changes, run `npm run format` to ensure formatting is consistent.

## Step 4 -- Provide release commands

After the file updates are done, present the user with the exact commands to run, clearly formatted:

```
git add CHANGELOG.md package.json
git commit -m "release: vX.X.X"
git tag vX.X.X
git push origin main --tags
```

Tell the user: these commands will commit the version bump, create the tag, and push everything including the tag. The GitHub Actions release workflow (if configured) will trigger from the new tag.

Do NOT run these commands yourself. Hand them off to the user.
