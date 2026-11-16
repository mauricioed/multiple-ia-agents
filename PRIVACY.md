# Privacidad y alcance de la copia

La copia de desarrollo y el VSIX no incluyen credenciales, perfiles de proveedores, conversaciones, modelos ni ejecutables. Se copió una lista de fuentes versionadas, sin historial Git del proyecto original. El nuevo identificador de extensión usa otro almacenamiento de VS Code.

La extensión no añade telemetría, no consulta cuotas de cuentas y no lee archivos de autenticación de Claude. El chat oficial de Claude y los CLI instalados por el usuario gestionan sus credenciales y están sujetos a las políticas de sus proveedores. Los procesos de CLI pueden heredar el entorno del usuario, como ocurre al ejecutarlos normalmente.

Durante el uso, se guardan localmente nombres de sesión, rutas de carpetas y mensajes de los paneles propios en el almacenamiento de VS Code. Los adjuntos seleccionados se leen al enviar y se incluyen en la solicitud al proveedor elegido. No incluyas secretos o documentos confidenciales en los mensajes si no estás autorizado a enviarlos. El chat oficial administra su propio historial y sus envíos de datos.

Los escaneos de patrones de credenciales y las comprobaciones de archivos excluidos reducen el riesgo de filtraciones en la distribución; no garantizan identificar todos los secretos posibles ni certifican los datos que introduzca un usuario posteriormente.
