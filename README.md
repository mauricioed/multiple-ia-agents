# Multiple AI Agent Chats

![VS Code ^1.145.0](https://img.shields.io/badge/VS%20Code-%5E1.145.0-4377bd) ![Version 0.1.21](https://img.shields.io/badge/version-0.1.21-655bd5) [![MIT License](https://img.shields.io/badge/license-MIT-56964d)](LICENSE)

Manage Codex, Claude Code, and Ollama from the **AI Agents** sidebar in VS Code. Each chat or terminal can use a different local folder. Selecting a session also switches the file explorer to its folder.

**Español.** Gestiona chats de Codex y Ollama, abre el chat oficial de Claude Code y ejecuta terminales de agentes en VS Code.

This project is independent of OpenAI, Anthropic, and Ollama.

## Demo

![Two chats and a terminal with separate folders, a floating Markdown editor, and chat history.](https://raw.githubusercontent.com/mauricioed/multiple-ia-agents/main/media/demo-extension.gif)

## Codex

Open independent chats with local history, attach files, and choose a permission mode. Install the official Codex CLI separately and sign in. If detection fails, set `multipleIAAgents.executables.codex` to its absolute path. JavaScript entry points such as `bin/codex.js` require Node.js on `PATH`.

## Claude Code

Open the official Claude Code chat from **AI Agents**. VS Code installs the official extension as a dependency. The Anthropic extension handles authentication, permissions, billing, and history. Multiple sidebar entries can point to the same Claude tab and close when that tab closes. [Claude Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)

For terminal sessions, install the official Claude CLI and sign in. The extension detects native and global npm installations, including Node.js version managers. If detection fails, set `multipleIAAgents.executables.claude`. JavaScript entry points require Node.js on `PATH`.

## Ollama

Use installed models for local chats and download models from the chat panel. Install Ollama separately and install a model to start chatting. The extension can use the local server on port 11434 or start its own on port 11435. If detection fails, set `multipleIAAgents.executables.ollama` to the executable's absolute path. Review each model's license and hardware requirements before using or distributing it. [Ollama downloads](https://ollama.com/download)

With a tool-capable model, you can ask the chat to list directories and read UTF-8 files in the chat folder. For files outside that folder, provide an absolute path. The chat asks for approval before sending external file contents to your local Ollama server. You can also attach files manually.

## Installation

Use VS Code 1.145 or later and open a trusted local workspace. Search for `Mauricio.multiple-ia-agents` in the **Extensions** view. To install a local build, run **Extensions: Install from VSIX...**, select the package in `artifacts/`, and reload VS Code.

## Using the sidebar

1. Open **AI Agents** from the Activity Bar or run **Multiple AI Agent Chats: Show AI Agents (no usage meters)** from the Command Palette.
2. Open the chat button's dropdown, choose an agent, and select a folder.
3. Select a session to return to it and browse its files. Double-click a Markdown file to open it in a floating editor.
4. In Codex or Ollama chats, use the clock icon to jump to a message. To restore a closed chat, run **Multiple AI Agent Chats: Reopen closed chat**.

Use the formatting toolbar to add emphasis, lists, code, links, or tables. Paste text or PNG, JPEG, and WebP images directly into the message editor. Images appear as removable attachments and require a model that supports image input.

The extension interface is available in English and Spanish.

## Terminal sessions

Open the terminal button's dropdown in **AI Agents**, select Codex, Claude, Ollama, or **Shell (no agent)**, and choose a starting folder. The terminal opens in the editor area. Select its sidebar entry to return to the terminal and browse its associated folder.

Closing the terminal removes its sidebar entry. Closing the entry also closes the terminal. Reopening it starts a new process in the saved folder. Changing directories inside the terminal preserves the folder associated with the session.

Agent terminals use the installed provider CLIs. The Ollama terminal uses an installed model. **Shell (no agent)** opens a system shell.

## Troubleshooting

- **Executable unavailable.** Install the official CLI and check its configured path. Use a native executable or JavaScript entry point. Files ending in `.cmd`, `.bat`, or `.ps1` are shell wrappers.
- **Ollama terminal fails to start.** Make sure Ollama is installed and run `ollama list` to verify that a model is available.
- **Claude terminal fails to start.** Make sure the Claude CLI is installed and signed in. The official chat uses the Anthropic extension.
- **Controls are missing after an update.** Run **Developer: Reload Window** from the Command Palette.

## Privacy and permissions

Codex and Ollama chat history, session names, and folder paths are stored locally in VS Code's extension storage. The extension operates without telemetry. Each provider handles its own authentication.

Messages and selected attachments are sent to your chat provider. Codex can run commands or edit files according to the selected permission mode. [Privacy policy](PRIVACY.md)

## Development

Use Node.js 22 or later and npm.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run verify:privacy
npm run verify:history
npm run verify:distribution
npm run package
```

Packaging regenerates the third-party notices and verifies the VSIX. Tests use sample data and run without real credentials. Optional UI checks require Microsoft Edge.

```sh
node integration/sidebar.cjs
node integration/ui.cjs
```

The Marketplace publisher ID is `Mauricio`. [Publishing guide](PUBLISHING.md)

## License

The project uses the [MIT License](LICENSE). Original dependency licenses are in [licenses/](licenses/), listed in the [third-party notices](THIRD_PARTY_NOTICES.md), and recorded with checksums in [DEPENDENCY-LICENSES.json](DEPENDENCY-LICENSES.json).

Provider services, external apps, trademarks, and models have their own terms. See the [license review](LICENSE_REVIEW.md) and [review report](REVIEW_REPORT.md) for the scope of the technical review.
