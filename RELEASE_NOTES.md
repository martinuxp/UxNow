# UxNow v0.1.0

Primera versión pública para Windows 10/11 x64.

- Receptor AirPlay de audio basado en uxPlay 1.74 y GStreamer 1.28.7, incluidos en los instaladores. No hay que compilarlos por separado.
- Selección de salida de audio exclusiva para UxNow, sin cambiar la salida predeterminada de Windows.
- Portada, metadatos, letras sincronizadas y biblioteca local TTML/LRC/ELRC; fuentes online opcionales con consentimiento.
- Modo demo, diagnóstico, bandeja del sistema y ajustes persistentes.
- Nuevo ajuste independiente «Sincronizar con uxPlay» para esperar el progreso real antes de mover el reloj de letras. La compensación global sigue siendo otro ajuste.

Instala el `.exe` (NSIS) o el `.msi`. Ambos incluyen el mismo runtime bajo `_internal`. El inventario de licencias y enlaces al código fuente correspondiente viene dentro del instalador.

La interfaz y las pruebas automatizadas se validaron localmente. También se extrajo el MSI y se comprobó que uxPlay, GStreamer y `wasapisink` arrancan desde sus recursos incluidos. Aún falta una prueba de instalación y recepción AirPlay en un Windows limpio sin MSYS2/GStreamer externo; considera esta versión una primera prueba pública.
