## 0.1.61

- Open native Claude Code tabs for distinct folders in the same VS Code window with the verified Claude Code 2.1.331 build on Windows x64.

## 0.1.60

- Keep Claude Code chats in the current VS Code window. Offer an integrated Claude Code terminal when the selected folder differs from the primary workspace folder.

## 0.1.59

- Keep the current Claude Code chat open when a new chat uses a different folder. Open the new chat in the VS Code window for its folder.

## 0.1.58

- Show AI Agents while Claude Code opens and create one separate chat for each new-chat request, including after changing folders.

## 0.1.57

- Reuse a restored Claude Code editor when returning to its folder from AI Agents.

## 0.1.56

- Reveal AI Agents when opening Claude Code in a different folder and show the linked chat once its editor is available, including on slower VS Code startups.

## 0.1.55

- Each native Claude Code chat created from AI Agents has its own editor tab and chat list entry.

## 0.1.53

- Keep the current VS Code window when changing folders for Claude Code and reuse a restored official tab.

## 0.1.52

- Ask for a folder before opening Claude Code and list the new chat in AI Agents in the window that hosts it.

## 0.1.48

- Open Claude chats with your subscription in Claude Code, in the active editor group and the chat folder. Each chat resumes its own conversation.
- Add a Claude chat panel that uses your own Anthropic API key, since Anthropic does not allow subscription sign-in in third-party extensions.

## 0.1.47

- Update the version badge and document the current chat history, GitHub Markdown Vault, and message queue in the extension overview.

## 0.1.46

- Show the local date and time of the last text message sent by the user in each closed-chat entry. Restore the selected conversation in the current panel and keep the previous chat in history.

## 0.1.45

- Sort closed chats by the timestamp of the last text message sent by the user, newest first.

## 0.1.44

- Preview the last text message sent by the user in each closed chat. Open new chats in the active editor group and restore chats in the originating group. Allow the official Claude panel to switch folders in the current window after confirmation.

## 0.1.43

- Give Send, Queue, and Stop distinct icons in the composer.

## 0.1.42

- Start Vault synchronization from its sidebar status control. Show the last user message in closed-chat history and reopen chats in the originating editor group.

## 0.1.41

- List closed chats from the current folder directly inside the chat panel and reopen saved conversations there.

## 0.1.40

- Edit the Vault name in the chat and move Markdown files to the trash from its explorer after confirmation.

## 0.1.39

- Show a preview of the latest available message when selecting a closed chat to reopen.

## 0.1.38

- Queue messages per chat while an agent is replying and show waiting messages in the composer.

## 0.1.37

- Use the selected Vault name when creating a private GitHub repository and verify the visibility of existing connections.

## 0.1.36

- Save the active conversation from the Vault dialog and preview the last available message for open chats.

## 0.1.35

- Restore the last open Vault folder and handle folders removed outside the extension.

## 0.1.34

- Insert a Markdown file into the active draft, export the active chat, and show whether the local Vault has changed since the last sync.

## 0.1.33

- Open the official Claude Code panel for the workspace folder or offer to switch to the selected folder.

## 0.1.32

- Manage Vault actions through forms inside the chat.

## 0.1.31

- Align Vault browsing, Markdown export, and GitHub sync across editions.

## 0.1.30

- Open existing Markdown folders in the Vault explorer and restore saved chat history.

## 0.1.29

- Keep active chats in the sidebar and make closed conversations available through the reopen command.

## 0.1.28

- Add GitHub Markdown Vault, an independent Markdown explorer, and synchronization with a private GitHub repository.

## 0.1.27

- Keep closed custom chats visible so reopening restores the saved conversation.

## 0.1.26

- Restore plain-text paste when the chat editor's text insertion command fails.

## 0.1.25

- Move the formatting toolbar below the message input.

## 0.1.24

- Raise the formatting toolbar slightly and simplify its visibility toggle to an icon button.

## 0.1.23

- Place the formatting toolbar inside the composer, directly above the message input.

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
