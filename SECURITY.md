# Security

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately through [GitHub's vulnerability reporting](https://github.com/tahabozdemir/claude-mods/security/advisories/new) instead.

## What the mods can access

Mods run inside Claude Code with the permissions of your user account, so here is what each one touches.

| Mod | Reads | Runs | Network |
| --- | --- | --- | --- |
| usage-band | The current session's transcripts in `~/.claude/projects/` (or `$CLAUDE_CONFIG_DIR/projects/`) | `node scripts/tokens.mjs <session id>` | None |

## Supported versions

Only the latest version of each mod gets security fixes.
