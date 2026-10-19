# Muestras de audio

## `prueba-es.wav`

Audio de 6,8 segundos en español, generado localmente con la voz TTS de Windows
**Microsoft Helena (es-ES)** en formato PCM 16 kHz, mono, 16 bits. No proviene de ningún archivo de
terceros y no tiene derechos asociados más allá de la licencia de este repositorio.

Frase hablada:

> Hola, esto es una prueba de dictado en español. La reunión empieza a las nueve y media de la mañana.

Se usa en la prueba de integración del proveedor de voz (ver
[`../docs/VERIFICACION.md`](../docs/VERIFICACION.md)):

```bash
node tools/test-whisper-provider.mjs samples/prueba-es.wav es \
  "Hola, esto es una prueba de dictado en español. La reunión empieza a las nueve y media de la mañana."
```

El script encuentra solo el Electron de DSH y se relanza con él. También acepta `auto` como idioma y
`WHISPER_MODEL=small` para probar la otra variante.

Para generar uno propio con otra frase, en Windows:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Helena Desktop')   # o Microsoft Sabina Desktop (es-MX)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile('mi-prueba.wav', $fmt)
$s.Speak('La frase que quieras dictar.')
$s.Dispose()
```
