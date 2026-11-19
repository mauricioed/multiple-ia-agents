## 0.1.20

- Permite ampliar hacia arriba el campo de escritura del chat.
- Admite adjuntos de texto e imagen (PNG, JPEG y WebP) y enlaces locales con línea y columna.
- Añade las etiquetas Claude, Codex y Ollama a la ficha de la extensión.
- Actualiza el icono con un reflejo sobre el fondo.

## 0.1.19

- Unifica en español la descripción y las insignias del Marketplace.
- Usa la URL directa del GIF de demostración en GitHub.

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

- Permite abrir el panel de Ollama aunque su programa no este instalado o su servidor no responda.

## 0.1.3

- Sincroniza el cierre del chat oficial de Claude con la lista de chats activos.

## 0.1.2

- Corrige la inicialización del explorador para mostrar chats y carpetas al cargar el panel.

# Cambios

## 0.1.1

- Identifica el panel como IA Agents para distinguirlo de la variante anterior.
- Mantiene eliminadas las consultas y barras propias de utilización.

## 0.1.0

- Nuevo proyecto y almacenamiento independiente.
- Claude utiliza la extensión oficial sin SDK ni autenticación propios.
- Elimina consultas y porcentajes de utilización de Claude y Codex.
- Codex y Ollama se instalan por separado; no se incluyen binarios ni modelos.
- Copia de fuentes sin perfiles ni conversaciones; avisos de licencias de producción verificables.
