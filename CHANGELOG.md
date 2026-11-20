## 0.1.22

- Move the formatting toolbar above the conversation. Add new icons and a button below the draft to show or hide it.

## 0.1.21

- Add a rich message editor and support pasting text and images into custom chats.
- Localize the extension description in English and Spanish.
- Handle file tool calls returned as plain JSON by Ollama models such as Qwen 2.5.
- Show extension details in English with sections for Codex, Claude Code, and Ollama.

## 0.1.20

- Allow the chat input to expand upward.
- Support text and image attachments (PNG, JPEG, and WebP) and local links with line and column positions.
- Add Claude, Codex, and Ollama tags to the extension listing.
- Update the icon with a highlight over the background.

## 0.1.19

- Use Spanish for the Marketplace description and badges.
- Use the direct URL for the demo GIF on GitHub.

## 0.1.18

- Add compatibility, version, and license badges and an animated walkthrough to the Marketplace overview.

## 0.1.17

- Apply permission changes during a pending approval by continuing in the same conversation under the new mode.

## 0.1.16

- Let compatible Ollama models list folders and read text files inside the chat folder, and request one-time approval for other local paths.

## 0.1.15

- Open folder links from chat responses.
- Remember the last permission mode for new chats and allow changes while an approval is pending.

## 0.1.14

- Repackage version 0.1.13 with an updated release version.

## 0.1.13

- Rename the sidebar and its opening command from IA Agents to AI Agents in English and Spanish.

## 0.1.12

- Rename the extension to Multiple AI Agent Chats.

## 0.1.11

- Add a Marketplace icon matching the IA Agents activity bar symbol.

## 0.1.10

- Align proportional dropdown arrows to the right of the chat and terminal icons, preserving their vertical size.

## 0.1.9

- Detect native and JavaScript Claude CLI entry points in global npm installations, including Node version manager paths.
- Keep Claude SDK imports and provider binaries excluded from the distribution.

## 0.1.8

- Restore full-size chat and terminal dropdown icons, with the arrow in the lower-right corner.

## 0.1.7

- Combine each agent dropdown icon and arrow into one toolbar button, with original light/dark SVG assets.

## 0.1.6

- Show chat and terminal icons followed by their respective agent dropdown arrows in the sidebar toolbar.

## 0.1.5

- Add a New terminal with agent dropdown for Codex, Claude, Ollama, and a shell without an agent.
- Associate each terminal with its selected folder, sidebar entry, file explorer, and independent close/reopen lifecycle.
- Preserve terminal mode when restoring sessions; keep Claude graphical chats separate from Claude CLI terminals.

## 0.1.4

- Allow the Ollama panel to open when Ollama is missing or the server is unavailable.

## 0.1.3

- Sync the active chat list when the official Claude chat closes.

## 0.1.2

- Fix explorer initialization so chats and folders appear when the panel loads.

# Changes

## 0.1.1

- Name the panel IA Agents to distinguish it from the previous variant.
- Keep usage queries and meters removed.

## 0.1.0

- Nuevo proyecto y almacenamiento independiente.
- Claude utiliza la extensión oficial sin SDK ni autenticación propios.
- Elimina consultas y porcentajes de utilización de Claude y Codex.
- Codex y Ollama se instalan por separado; no se incluyen binarios ni modelos.
- Copia de fuentes sin perfiles ni conversaciones; avisos de licencias de producción verificables.
