# Multiple AI Agent Chats

![VS Code ^1.145.0](https://img.shields.io/badge/VS%20Code-%5E1.145.0-4377bd) ![Versión 0.1.20](https://img.shields.io/badge/versi%C3%B3n-0.1.20-655bd5) [![Licencia MIT](https://img.shields.io/badge/licencia-MIT-56964d)](LICENSE)

Gestiona chats de Codex, Claude Code y Ollama y sesiones de terminal desde la barra lateral **AI Agents** de VS Code. Cada sesión se vincula a la carpeta que elijas. Al cambiar de sesión, el explorador muestra los archivos de la carpeta correspondiente.

Este proyecto es independiente de OpenAI, Anthropic y Ollama.

## Demostración

![Demostración de dos chats y una terminal con carpetas independientes, un archivo Markdown en una ventana flotante y el historial de cada chat.](https://raw.githubusercontent.com/mauricioed/multiple-ia-agents/main/media/demo-extension.gif)

## Funciones

- Abre varios chats de Codex u Ollama con historiales locales independientes y adjunta archivos de texto.
- Abre el chat oficial de Claude desde **AI Agents** con la extensión de Anthropic.
- Abre terminales de Codex, Claude u Ollama, o una terminal de comandos sin agente.
- Explora la carpeta de la sesión activa, despliega subcarpetas y abre archivos. Los documentos Markdown se muestran en una ventana flotante.
- Selecciona el modo de permisos de Codex y descarga modelos de Ollama cuando los necesites.
- La interfaz está disponible en español e inglés.

## Requisitos

- **VS Code 1.145 o posterior**, con un espacio de trabajo local y la confianza del espacio de trabajo habilitada.
- **Codex.** Instala por separado la CLI oficial de Codex e inicia sesión. Si la extensión no encuentra el ejecutable, configura su ruta absoluta en `multipleIAAgents.executables.codex`. La instalación global de npm con `bin/codex.js` requiere Node.js en `PATH`.
- **Chat de Claude.** VS Code instala la [extensión oficial de Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) como dependencia. La extensión de Anthropic gestiona la autenticación, los permisos, la facturación y el historial.
- **Terminal de Claude.** Instala por separado la CLI oficial de Claude. La extensión detecta ejecutables nativos e instalaciones globales de npm, incluidas las gestionadas por un gestor de versiones de Node.js. Las entradas JavaScript requieren Node.js en `PATH`. Si la detección automática falla, configura `multipleIAAgents.executables.claude`.
- **Ollama.** [Instala Ollama](https://ollama.com/download) por separado. Si hace falta, indica la ruta absoluta de su ejecutable en `multipleIAAgents.executables.ollama`. La extensión puede usar el servidor local del puerto 11434 o iniciar un proceso propio en el puerto 11435. Instala un modelo para generar respuestas.

Cada usuario configura su acceso a los proveedores e instala los ejecutables, bibliotecas de GPU y pesos de los modelos que necesite. Cada modelo tiene su propia licencia y sus propios requisitos de hardware.

## Instalación

El identificador de la extensión es `Mauricio.multiple-ia-agents`. Puedes instalarla desde la vista **Extensiones** de VS Code. Para instalar un paquete compilado localmente, ejecuta **Extensiones: Instalar desde VSIX...**, elige el archivo de `artifacts/` y recarga VS Code.

## Uso

1. Abre **AI Agents** en la barra de actividades o ejecuta **Multiple AI Agent Chats: Mostrar AI Agents (sin medidores)** desde la paleta de comandos.
2. Pulsa la flecha del icono de chat para abrir **Nuevo chat con agente** y elige Codex, Claude u Ollama.
3. Selecciona una carpeta. Codex y Ollama se abren en sus paneles de chat y Claude se abre en su panel oficial.
4. Selecciona cualquier sesión de la barra lateral para volver a ella y explorar su carpeta. Haz doble clic en un archivo Markdown del árbol para abrirlo en una ventana flotante.
5. En Ollama, elige un modelo instalado o pulsa **Descargar modelo**. Revisa la licencia del modelo antes de usarlo o distribuirlo.
6. En un chat de Codex u Ollama, pulsa el icono del reloj y elige un mensaje para saltar a él. Para recuperar el historial de una conversación cerrada, ejecuta **Multiple AI Agent Chats: Reabrir chat cerrado** y selecciona la conversación.

Si tu modelo de Ollama admite llamadas a herramientas, puedes pedirle que busque documentación del proyecto o darle la ruta de un archivo. Las herramientas permiten listar carpetas y leer archivos de texto UTF-8 dentro de la carpeta del chat. Para acceder a un archivo de fuera, indica su ruta absoluta. El chat muestra la ruta y pide tu aprobación para esa operación antes de enviar el contenido al servidor local de Ollama. También puedes adjuntar archivos manualmente.

Las entradas de Claude abren su panel oficial. Varias entradas pueden estar vinculadas a la misma pestaña, y se cierran juntas al cerrar esa pestaña.

## Sesiones de terminal

En **AI Agents**, pulsa la flecha del icono de terminal y elige **Nueva terminal con agente**. Selecciona Codex, Claude, Ollama o **Terminal sin agente**, y elige la carpeta de inicio. La terminal se abre en el área del editor. Al elegirla en la barra lateral, se muestra esa misma terminal y el árbol de su carpeta asociada.

Cerrar la terminal la retira de la lista activa. Cerrar su entrada en la lista también cierra la terminal. Reabrirla inicia un proceso nuevo en la carpeta guardada. Cambiar de directorio dentro de la terminal conserva la carpeta vinculada a la sesión.

Las terminales con agente usan la CLI instalada de cada proveedor. La terminal de Ollama usa un modelo ya instalado. **Terminal sin agente** usa una terminal de comandos del sistema.

## Solución de problemas

- **La extensión no encuentra un ejecutable.** Instala la CLI oficial del agente. Si la instalaste en una ubicación personalizada, configura la ruta a un ejecutable nativo o a una entrada JavaScript. Los archivos `.cmd`, `.bat` y `.ps1` son envoltorios y no sirven como ruta al ejecutable.
- **La terminal de Ollama no arranca.** Confirma que Ollama está instalado y comprueba con `ollama list` que tienes al menos un modelo.
- **La terminal de Claude no arranca.** Instala la CLI de Claude e inicia sesión en ella. El chat gráfico usa por separado la extensión oficial de Anthropic.
- **Los controles nuevos no aparecen tras actualizar.** Ejecuta **Desarrollador: Volver a cargar ventana** desde la paleta de comandos.

## Privacidad y permisos

Los historiales de Codex y Ollama, los nombres de las sesiones y sus rutas se guardan localmente en el almacenamiento de la extensión de VS Code. La extensión funciona sin telemetría. Las herramientas de cada proveedor gestionan su propia autenticación.

Los mensajes y los adjuntos seleccionados se envían al proveedor del chat. Codex puede ejecutar comandos o modificar archivos según el modo de permisos elegido. Consulta la [política de privacidad](PRIVACY.md).

## Desarrollo

Usa Node.js 22 o posterior y npm.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run verify:privacy
npm run verify:history
npm run verify:distribution
npm run package
```

El empaquetado regenera los avisos de terceros y verifica el VSIX. Las pruebas funcionan con datos de ejemplo y sin credenciales reales.

Las comprobaciones de interfaz opcionales requieren Microsoft Edge.

```sh
node integration/sidebar.cjs
node integration/ui.cjs
```

Antes de publicar, consulta la [guía de publicación](PUBLISHING.md). El identificador del editor en el Marketplace es `Mauricio`.

## Licencia

El proyecto se distribuye bajo la [licencia MIT](LICENSE). Las licencias originales de las dependencias incluidas se conservan en [licenses/](licenses/), se enumeran en el [aviso de terceros](THIRD_PARTY_NOTICES.md) y se registran con sus sumas de verificación en [DEPENDENCY-LICENSES.json](DEPENDENCY-LICENSES.json).

Los servicios de los proveedores, las aplicaciones externas, las marcas y los modelos se rigen por sus propios términos. Consulta la [revisión de licencias](LICENSE_REVIEW.md) y el [informe de revisión](REVIEW_REPORT.md) para conocer el alcance de la revisión técnica.
