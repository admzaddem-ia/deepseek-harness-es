# Contribuir

¡Gracias por querer mejorar el español de DeepSeek Harness! Hay muchas formas de aportar, y la
mayoría no requiere saber programar.

## Reportar o proponer

- **Una traducción que suena rara o es incorrecta:** abrí un *issue* con la pantalla, el texto que
  ves y qué propondrías.
- **Una pantalla que quedó en inglés:** es una clave que falta. Contá en qué pantalla aparece y, si
  podés, buscá el texto en `tools/corpus/corpus.json` (está en inglés).
- **Un error del dictado:** incluí la variante de modelo (`base` o `small`), el idioma elegido y, si
  es posible, el audio.

## Reglas de traducción

1. **Los `{marcadores}` se copian tal cual** (`{count}`, `{name}`, `{path}`…). Nunca se traducen,
   renombran ni se les cambia la cantidad.
2. **Las claves no se tocan.** Son identificadores internos.
3. **Español neutro (es-419)**, profesional y conciso, con imperativos estándar: «Guardar»,
   «Cancelar», «Reintentar». Sin regionalismos ni voseo.
4. **Se mantienen los términos técnicos y los nombres propios**: `token`, `plugin`, `JSON`, `MCP`,
   `sandbox`, `markdown`, `DeepSeek`, `Harness`, `Bash`…
5. **Longitud parecida al original.** Son etiquetas de interfaz: no las alargues de más.
6. **Los espacios y la puntuación final se conservan**, incluidos los `…` y los `:` finales.

Glosario de referencia (mantené la coherencia): sesión, espacio de trabajo, herramienta, habilidad,
subagente, objetivo, tarea, aprobación, permiso, configuración, comando, atajo, archivo, carpeta,
adjunto, transcripción, turno, flujo de trabajo, proveedor, modelo, esfuerzo de razonamiento,
entrada de voz, micrófono, idioma, búsqueda.

## Cambios de código

Antes de abrir un pull request:

```bash
node tools/ci-validate.mjs            # manifiestos, JSON y rutas portables
node tools/verify-client-bundle.mjs   # cobertura completa del bundle del idioma
```

Para cambios en el proveedor de voz, además corré la prueba de integración que está descripta en
[`docs/VERIFICACION.md`](docs/VERIFICACION.md).

Requisitos para el PR:

- [ ] `node tools/ci-validate.mjs` pasa.
- [ ] `node tools/verify-client-bundle.mjs` imprime `PASS`.
- [ ] No hay rutas absolutas de tu máquina ni datos personales.
- [ ] Si agregaste textos, actualizaste `tools/corpus/batches/` y regeneraste `locale-es/client.js`.
- [ ] Describís cómo verificaste el cambio.

## Agregar otro idioma

El repositorio está pensado para que el paquete del idioma se pueda copiar. Los pasos exactos están
en [`docs/DESARROLLO.md`](docs/DESARROLLO.md), sección «Agregar otro idioma». Un paquete de idioma
nuevo (portugués, italiano, francés…) es una contribución muy bienvenida.

## Publicar tu propio fork

1. Revisá que los ejemplos de URL de los documentos usen **tu** usuario de GitHub (si publicás desde
   otra cuenta, cambialos).
2. Revisá `git status` (sin `node_modules`, sin modelos, sin rutas personales).
3. `git init && git add . && git commit -m "…" && git push`.

Ver [`docs/DESARROLLO.md`](docs/DESARROLLO.md), sección «Publicar», para los comandos completos.

## Licencia de las contribuciones

Al contribuir aceptás que tu aporte se distribuya bajo la licencia MIT de este repositorio
(ver [`LICENSE`](LICENSE)).
