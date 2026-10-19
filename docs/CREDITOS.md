# Créditos y licencias

Este repositorio es un complemento no oficial. No está afiliado ni respaldado por DeepSeek.

## Componentes

| Componente | Uso acá | Licencia | Origen |
|---|---|---|---|
| DeepSeek Harness | Producto al que se agregan los plugins; las cadenas de interfaz en inglés son suyas | MIT | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| Traducciones al español | Contenido de `locale-es/` | MIT (este repositorio) | Este repositorio |
| Proveedor de voz | `speech-to-text-whisper/` | MIT (este repositorio) | Este repositorio |
| `sherpa-onnx-node` 1.13.8 y `sherpa-onnx-win-x64` 1.13.8 | Runtime nativo con el que se ejecuta Whisper; **ya viene incluido en DSH** | Apache-2.0 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| Whisper (OpenAI) | Modelo de reconocimiento; los pesos se descargan en tiempo de ejecución | MIT (modelo original de OpenAI) | [openai/whisper](https://github.com/openai/whisper) |
| `csukuangfj/sherpa-onnx-whisper-base` y `-small` | Conversión a ONNX de los pesos que descarga el plugin | Ver el repositorio del modelo | [Hugging Face](https://huggingface.co/csukuangfj/sherpa-onnx-whisper-base) |
| Silero VAD | Detección de voz para trocear el audio | MIT (proyecto original) | [snakers4/silero-vad](https://github.com/snakers4/silero-vad) · espejo de descarga `csukuangfj/vad` |
| Microsoft Helena (voz TTS de Windows) | Generó `samples/prueba-es.wav` | — | Windows 11 (`System.Speech`), audio generado localmente |

## Qué NO se redistribuye

- **Pesos de modelos.** El plugin los descarga desde Hugging Face a la carpeta del usuario
  (`$DSH_HOME/speech-to-text/whisper/models`). Cada repositorio de modelos conserva su licencia.
- **Código de DeepSeek Harness.** Acá solo hay plugins que usan sus APIs públicas; las cadenas
  inglesas se usan como fuente de traducción y se distribuyen bajo MIT.
- **Audio de terceros.** El único audio del repositorio (`samples/prueba-es.wav`) se generó en esta
  máquina con la voz TTS del sistema.

## Atribución

Si reutilizás esta traducción o el proveedor de voz en otro proyecto, mantené el aviso de copyright
de [`LICENSE`](../LICENSE) y, si te sirve, enlazá este repositorio como origen. Los avisos de
terceros están resumidos también en [`NOTICE`](../NOTICE).
