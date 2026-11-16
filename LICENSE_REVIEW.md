# Revisión de licencias y distribución

Fecha de revisión: 16 de noviembre de 2026. Alcance: fuentes de esta variante y paquetes JavaScript de producción del lockfile. Esta revisión técnica no es un dictamen jurídico ni garantiza el cumplimiento de todas las cláusulas en todos los usos.

## Decisiones aplicadas

1. Se conserva el texto MIT original en LICENSE.
2. No se redistribuyen el SDK, ejecutable, interfaz, logos ni credenciales de Anthropic. El chat invoca un comando de la extensión oficial instalada por el usuario. Las sesiones de terminal opcionales ejecutan el CLI oficial instalado por el usuario, sin modificarlo ni distribuirlo. No se restringen sus métodos de autenticación.
3. No se consultan cuotas de Claude ni de Codex ni se inyectan indicadores en sus interfaces oficiales.
4. No se redistribuyen Codex, Ollama, bibliotecas de GPU ni pesos de modelos. El usuario los instala bajo sus propios acuerdos.
5. Los cuatro iconos de estado importados se han sustituido por geometría SVG original; no se usa el paquete de iconos de terceros de la variante anterior. Los demás iconos son formas geométricas del código base MIT; se conserva su aviso.
6. El generador de avisos copia sin modificar LICENSE/NOTICE de cada dependencia de producción y registra sus hashes. La verificación bloquea cambios de dependencias sin revisar.

## Referencias primarias

- Claude Code, licencia y condiciones: https://code.claude.com/docs/en/legal-and-compliance
- Integración oficial de VS Code y comandos: https://code.claude.com/docs/en/vs-code
- Términos comerciales de Anthropic: https://www.anthropic.com/legal/commercial-terms
- Licencias de las versiones concretas redistribuidas: archivos locales en licenses/ e inventario DEPENDENCY-LICENSES.json, obtenidos de los paquetes instalados con el lockfile.

## Límites y comprobaciones antes de distribución pública

Los proveedores externos y VS Code conservan sus condiciones y marcas. No se afirma afiliación. Una licencia MIT de nuestro código no concede derechos sobre sus productos. Deben revisarse las condiciones aplicables del Marketplace y del titular del publisher antes de publicar allí. Los cambios de versiones, nuevos recursos, modificación de avisos o incorporación de binarios requieren repetir esta revisión. No se certifica que futuros usos, credenciales o modelos aportados por usuarios cumplan sus acuerdos.

## Revalidación de la versión 0.1.10

Se verificaron otra vez las siete dependencias de producción, sus textos y hashes, el historial Git accesible y el VSIX. Los iconos combinados de los desplegables son geometría SVG original, sin logos ni fuentes importados. La detección de Claude instalado mediante npm solo localiza su ejecutable externo; no importa ni redistribuye el SDK.

La documentación vigente de Anthropic indica que preinstalar o ejecutar Claude Code en un producto requiere aceptar sus términos comerciales salvo acuerdo distinto. Conservamos el binario y la autenticación oficiales sin modificaciones, cada usuario usa su propia cuenta y no revendemos acceso. Esta revisión no puede certificar la aceptación contractual del titular ni sustituir una autorización escrita cuando sea aplicable. La ausencia de binarios redistribuidos no elimina por sí sola las condiciones del proveedor.
