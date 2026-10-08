# claude-mods

[![CI](https://github.com/tahabozdemir/claude-mods/actions/workflows/ci.yml/badge.svg)](https://github.com/tahabozdemir/claude-mods/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Small mods for [Claude Code](https://claude.com/claude-code). Each one is a plugin you install with a single command, and it works in the terminal and in the desktop app.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img alt="Claude Code in a terminal with the usage band above the prompt: 5-hour limit at 40% in yellow, 7-day limit at 58%, context at 62%, and token counts" src="docs/images/hero-light.png">
</picture>

## Mods

| Mod | What it does |
| --- | --- |
| [**usage-band**](mods/usage-band) | Shows your rate limits, context and token use in a row above the prompt, and turns yellow before you run out. |

## Install

You need Claude Code in a terminal. Installing takes three steps:

1. Start Claude Code with `claude`.
2. Paste this line at the prompt and press Enter:

   ```
   /plugin install usage-band --marketplace tahabozdemir/claude-mods
   ```

3. Answer the questions it asks:
   - **Add marketplace?** Type `y`.
   - **Scope:** press Enter to install it for yourself in every project.
   - **Options:** press Enter to keep the defaults.

That's it. The band shows up above the prompt after your first message.

> [!TIP]
> Using the Claude desktop app? Install once from a terminal as above. The mod then shows in the desktop app's Code tab too.

### Update

```sh
claude plugin marketplace update claude-mods
claude plugin update usage-band@claude-mods
```

Restart Claude Code to load the new version.

### Uninstall

```sh
claude plugin uninstall usage-band@claude-mods
```

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers running a mod from source, testing it, and adding a new one. To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Taha Bozdemir
