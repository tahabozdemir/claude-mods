# Contributing

Thanks for helping out. This guide covers running a mod from source, checking it, and adding a new one.

## Setup

- [Claude Code](https://claude.com/claude-code), the latest version. Its CLI validates and tests mods; nothing else is needed for that.
- [Bun](https://bun.sh) and Google Chrome, only to regenerate the README images.

## Repository layout

```
.claude-plugin/marketplace.json   lists every mod, so /plugin install can find them
mods/<mod>/                       one folder per mod, a Claude Code plugin
  .claude-plugin/plugin.json      the mod's manifest: name, version, options
  hooks/hooks.json                points at the hooks module
  hooks/register.tsx              the hooks module
  tests/*.test.ts                 tests, run by claude plugin test
  README.md                       the mod's own docs
docs/images/                      images used by the READMEs
tools/screenshots/                regenerates those images
```

## Run a mod from source

```sh
claude --plugin-dir ./mods/usage-band
```

The mod loads from this folder for that session only. Saving a file reloads it in the running session. If you also have the mod installed from the marketplace, uninstall it first so the two copies don't both run.

## Check your change

Run these before opening a pull request. CI runs the first three too.

```sh
claude plugin validate .                  # the marketplace file
claude plugin validate mods/usage-band    # the manifest and the hooks module
claude plugin test mods/usage-band        # the tests
tsc -p mods/usage-band                    # types (after the mod has loaded once)
```

Claude Code writes the type definitions to `mods/<mod>/.claude-plugin/types/` the first time it loads the mod. That folder is git-ignored.

If you changed how the band looks, regenerate the images and commit them with the change:

```sh
bun tools/screenshots/render.ts
```

## Add a new mod

1. Create `mods/<mod>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json` and the hooks module. Use `mods/usage-band` as a template.
2. Add at least one `tests/*.test.ts`.
3. Add the mod to `.claude-plugin/marketplace.json` with `"source": "./mods/<mod>"`.
4. Add a `README.md` in the mod folder, a row in the table in the main README, and an entry in `CHANGELOG.md`.

## Releasing

Installed copies only update when the version changes, so every release needs a version bump.

1. Bump `version` in `mods/<mod>/.claude-plugin/plugin.json`, following [semantic versioning](https://semver.org).
2. Move the `Unreleased` notes in `CHANGELOG.md` under the new version.
3. Commit, then tag the release and push the tag:

   ```sh
   claude plugin tag mods/<mod>     # creates <mod>--v<version>
   git push --tags
   ```

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org), scoped to the mod: `feat(usage-band): show the 7d reset as a weekday`, `fix(usage-band): …`, `docs: …`.

## Pull requests

Keep each pull request to one change, describe what it does and why, and include a screenshot when it changes what a mod draws.
