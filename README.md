# Multiple IA Agents

A VS Code extension for managing Codex, Claude Code, and Ollama chats and native terminal sessions from one **IA Agents** sidebar. Each session is associated with a selected folder, and the explorer follows the active session. Use custom Codex and Ollama chat panels, the official Claude graphical chat, or an agent running in a terminal.

This is an independent project. It is not an official product of, or endorsed by, OpenAI, Anthropic, or Ollama.

## Features

- Custom chat panels for Codex and Ollama, with separate sessions, local history, and file attachments.
- Two compact toolbar dropdowns: a chat icon with a right-hand arrow for **New chat with agent**, and a terminal icon with a right-hand arrow for **New terminal with agent**.
- Native editor terminals for Codex, Claude, Ollama, or a shell without an agent, with independent folders, selection, and close/reopen behavior.
- Launch the official Claude Code graphical chat using Anthropic's installed VS Code extension.
- Browse the active session's folder, expand subfolders, and open files from the sidebar.
- Open Markdown previews in a separate editor window.
- Choose Codex permission modes and explicitly download Ollama models.
- No account quota requests or custom session/weekly usage percentage bars.
- English and Spanish interface translations.

## Requirements

- VS Code **1.145 or later**, a local filesystem workspace, and Workspace Trust enabled.
- **Codex:** install the official Codex CLI separately and complete its own sign-in process. If it cannot be found, set `multipleIAAgents.executables.codex` to its absolute executable path. A global npm installation using `bin/codex.js` also requires Node.js on `PATH`.
- **Claude chat:** the official [Claude Code extension](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code). VS Code installs it as an extension dependency. Authentication, permissions, billing, and conversation history remain under the official extension's control.
- **Claude terminal:** install the official Claude CLI separately. Native executables and global npm installations are detected, including npm installations under Node version managers. JavaScript CLI entries require Node.js on `PATH`. Set `multipleIAAgents.executables.claude` if automatic detection is unavailable.
- **Ollama:** [install Ollama](https://ollama.com/download) separately. If needed, set `multipleIAAgents.executables.ollama` to the absolute executable path. The extension can use a local server on port 11434 or start its own local process on port 11435. A model must be installed before generating responses. Opening our chat does not install Ollama or download a model.

Provider executables, credentials, GPU libraries, and model weights are **not bundled** with this extension. Each user supplies their own provider access. Models have their own license and hardware requirements.

## Installation

The extension identifier is `Mauricio.multiple-ia-agents`.

Build a VSIX from source using the commands below, then run **Extensions: Install from VSIX...** in VS Code and select the generated file under `artifacts/`. Reload VS Code after installing an update.

## Usage

1. Open **IA Agents** in the Activity Bar, or run **Multiple IA Agents: Show IA Agents (no usage meters)** from the Command Palette.
2. Click the **chat icon with its right-hand arrow** to open **New chat with agent**, then choose Codex, Claude, or Ollama. Use the **terminal icon with its right-hand arrow** for terminal sessions.
3. Select the chat's folder. For Codex and Ollama, write in our custom panel; for Claude, use the official graphical panel.
4. Select a chat or terminal in the sidebar to reveal it and browse its associated folder. Expand folders and open files; double-click Markdown files to open their preview.
5. For Ollama, choose an installed model, or explicitly use **Download model** after installing the runtime. Review that model's license before using or distributing it.

Claude entries are launchers for the official panel, not a guaranteed one-to-one mapping to Anthropic conversation IDs. Closing a tracked official tab removes its linked entries from the active list; entries sharing that tab close together. The official extension controls any usage information it displays itself.

## Terminal sessions

Use **New terminal with agent** in the IA Agents toolbar and choose Codex, Claude, Ollama, or **Shell (no agent)**. Select a folder; the terminal opens in the editor area with that folder as its initial working directory. Selecting its sidebar entry reveals the same terminal and switches the file explorer to its associated folder. Closing the terminal removes it from the active list; closing its list entry also disposes the terminal. Reopening a closed terminal starts a new process in the saved folder, not a restored terminal transcript. Changing directories inside the shell does not reassign the session's folder.

Agent terminals require the corresponding CLI to be installed separately. For Claude terminals, install the official Claude CLI and optionally configure `multipleIAAgents.executables.claude`; Claude chat entries continue to use the official graphical extension. An Ollama terminal asks for an installed model and runs it without downloading models automatically. A shell without an agent needs no provider executable. Authentication and interactive permissions stay with the installed tools; no credentials or executables are bundled.

## Troubleshooting

- **An agent executable cannot be found:** install its official CLI separately, then retry. If it is installed in a custom location, use the corresponding executable setting above. Select a native executable or a JavaScript entry point, not a shell wrapper such as a .cmd, .bat, or .ps1 file.
- **Ollama terminal fails:** confirm Ollama is installed and that at least one model is available with **ollama list**. The terminal picker uses installed models and never downloads one automatically. Our Ollama chat can open without the runtime, but generating responses still requires a working installation and a model.
- **Claude terminal fails:** the graphical Claude extension and the Claude CLI are separate requirements. A working official chat does not by itself guarantee the CLI is available. The terminal reuses the installed CLI's own authentication; no new API key is requested by this extension.
- **New controls do not appear after an update:** run **Developer: Reload Window** from the Command Palette.

## Privacy and permissions

The extension adds no telemetry and does not read Claude authentication files. Provider tools manage their own authentication and may inherit the process environment. Custom chat histories, session names, and folder paths are stored locally in VS Code extension storage.

Messages and selected attachments are sent to the chosen backend. Codex can execute commands or modify files according to the selected permissions. Ollama models are downloaded only after an explicit action. Do not send confidential material unless you are authorized to share it with that provider. See [PRIVACY.md](PRIVACY.md).

## Development

Use Node.js 22 or later and npm:

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run verify:privacy
npm run verify:history
npm run verify:distribution
npm run package
```

Packaging regenerates third-party notices and verifies the VSIX contents. It rejects recognized credential patterns, private profiles, provider binaries, unreviewed runtime dependencies, and missing or modified license notices. Tests do not require real provider credentials.

Optional browser checks require Microsoft Edge:

```sh
node integration/sidebar.cjs
node integration/ui.cjs
```

Read [PUBLISHING.md](PUBLISHING.md) before publishing. Marketplace releases use the `Mauricio` publisher. Never commit access tokens or provider account files.

## License

Project code is available under the [MIT License](LICENSE), with its original copyright notice preserved. Bundled JavaScript dependency licenses are preserved in [licenses/](licenses/), listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and recorded with hashes in [DEPENDENCY-LICENSES.json](DEPENDENCY-LICENSES.json).

Provider services, external applications, trademarks, and model weights remain subject to their respective terms. See [LICENSE_REVIEW.md](LICENSE_REVIEW.md) and [REVIEW_REPORT.md](REVIEW_REPORT.md) for the scope and limitations of the technical review.
