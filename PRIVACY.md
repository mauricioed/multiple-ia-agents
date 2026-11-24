# Privacidad y alcance de la copia

La copia de desarrollo y el VSIX no incluyen credenciales, perfiles de proveedores, conversaciones, modelos ni ejecutables. Se copió una lista de fuentes versionadas, sin historial Git del proyecto original. El nuevo identificador de extensión usa otro almacenamiento de VS Code.

La extensión no añade telemetría, no consulta cuotas de cuentas y no lee archivos de autenticación de Claude. Claude Code y los CLI instalados por el usuario gestionan sus credenciales. La clave de API de Anthropic que configure el usuario para el chat de Claude se guarda en el almacén seguro de VS Code y solo se entrega a Claude Code en la variable `ANTHROPIC_API_KEY`. No llega al panel, al historial, a las exportaciones ni a los registros. Su uso está sujeto a las políticas de cada proveedor. Los procesos de CLI pueden heredar el entorno del usuario, como ocurre al ejecutarlos normalmente. El chat con clave de API retira del entorno las demás credenciales de Anthropic.

Durante el uso, se guardan localmente nombres de sesión, rutas de carpetas y mensajes de los paneles propios en el almacenamiento de VS Code. Los adjuntos seleccionados se leen al enviar y se incluyen en la solicitud al proveedor elegido. No incluyas secretos o documentos confidenciales en los mensajes si no estás autorizado a enviarlos. Claude Code guarda las conversaciones en su propio almacenamiento y administra sus envíos de datos.

GitHub Markdown Vault guarda localmente el registro de carpetas y la selección activa. Al confirmar una sincronización, usa la sesión de GitHub de VS Code y transfiere los archivos versionados de la bóveda a un repositorio de GitHub cuya visibilidad privada se ha verificado. Git conserva los cambios como commits en la bóveda local.

Los escaneos de patrones de credenciales y las comprobaciones de archivos excluidos reducen el riesgo de filtraciones en la distribución; no garantizan identificar todos los secretos posibles ni certifican los datos que introduzca un usuario posteriormente.
