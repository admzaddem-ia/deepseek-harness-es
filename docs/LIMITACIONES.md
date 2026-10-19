# Límites conocidos

Todo lo que sigue está comprobado en la versión probada (DSH `0.2.0-rc.2`, Windows 11 x64). Si algo
te resulta raro, probablemente esté acá.

## Interfaz

- **El selector de idioma del dictado muestra `es`, no «Español».** El bundle de voz de DSH trae
  nombres traducidos solo para `auto/zh/en/yue/ja/ko`; cualquier otro idioma se muestra con su
  código. No se puede corregir sin modificar la instalación de DSH.
- **La vista previa de planillas de cálculo queda en inglés.** La clave `sidebarExcel.language` es
  un identificador del renderizador, no texto de interfaz, así que se dejó en `en`.
- **127 textos son iguales al inglés** porque son términos técnicos o nombres propios: `token`,
  `plugin`, `JSON`, `MCP`, `HTTP`, `DeepSeek`, `Harness`, `Bash`, `cron`… Es intencional.
- **La traducción es español neutro (es-419).** Si tu variante preferida usa otro vocabulario
  («Configuración» en vez de «Ajustes», por ejemplo), es una discusión abierta y bienvenida.
- **No se traduce lo que escribe el modelo.** Este paquete localiza la interfaz de DSH; las
  respuestas del agente dependen del modelo y del idioma en que le escribas.
- **El idioma de la interfaz es por perfil.** Cambiarlo afecta a todas las sesiones de ese perfil.
- **Mientras el paquete esté instalado, el español se vuelve a seleccionar en cada carga** (el propio
  paquete llama a `setLocale`). Es intencional: es lo que lo hace autorreparable frente a que la
  aplicación reescriba el patch del perfil. Para usar otro idioma, desinstalá el paquete o poné
  `preference: false` en su fila.
- **Fallo seguro:** si una versión futura de DSH renombra un namespace, esas pantallas vuelven a
  mostrarse en inglés en lugar de mostrar claves crudas.

## Voz

- **No hay transcripción en tiempo real.** Se graba, se suelta y se transcribe; no hay resultados
  parciales mientras hablás.
- **Límites por grabación:** 120 segundos y 4 MB (los aplica la API de voz de DSH, no el plugin).
  Para audios largos conviene cortarlos.
- **Solo CPU.** El proveedor usa `provider: 'cpu'`; no aprovecha GPU aunque esté disponible.
- **Precisión:** `base` int8 es rápido y suficiente para dictado corto, pero confunde palabras poco
  frecuentes (en la prueba cambió «dictado» por «dedicada»). `small` int8 mejora algo la precisión a
  costa de ~2,7x más tiempo.
- **Latencia medida:** 6,8 s de audio en 2,98 s (`base`) y 7,33 s (`small`) en la máquina de
  prueba. Con audio largo, la latencia crece de forma aproximadamente lineal.
- **Volver a SenseVoice tiene una trampa:** si elegís SenseVoice con el idioma en `es`, DSH rechaza
  la selección («does not support language: es»). Elegí un idioma que SenseVoice conozca
  (`auto`, `zh`, `en`, `yue`, `ja`, `ko`) o dejá Whisper seleccionado.
- **Sin proveedores en la nube.** El español funciona sin conexión después de la primera descarga.
  Un proveedor remoto requeriría otra implementación.
- **El audio no sale de la máquina.** Se envía por un socket `127.0.0.1` autenticado con un token
  aleatorio por proceso, entre la mitad Host y el proceso de reconocimiento.

## Instalación y repositorio

- **El perfil apunta con un enlace simbólico a la carpeta del repositorio.** Si la movés o la
  borrás, los plugins dejan de cargar (la interfaz vuelve a inglés y el dictado queda solo con
  SenseVoice). Para arreglarlo, reinstalá desde la ruta nueva.
- **Un paquete por especificación.** Este repositorio trae dos paquetes en subcarpetas; las
  instalaciones por dirección Git funcionan mejor si publicás cada paquete como repositorio propio.
- **Los modelos no se distribuyen.** Se descargan la primera vez desde Hugging Face (~162 MB `base`
  int8, ~377 MB `small` int8, más 1,8 MB de VAD) y quedan en
  `$DSH_HOME/speech-to-text/whisper/models`.
- **Compatibilidad de versiones.** El plugin usa las APIs públicas `locale` y `speechToText` de DSH.
  Si cambian de forma incompatible en una versión futura, hay que actualizar el plugin; en la versión
  probada (`0.2.0-rc.2`) funciona.
