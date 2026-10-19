/**
 * Prueba de permanencia: quita a propósito la preferencia de idioma del patch del perfil, para
 * comprobar que el propio paquete @local/dsh-locale-es la vuelve a escribir al cargar la página.
 *
 * Uso: node tools/quitar-preferencia-perfil.mjs <ruta del cordis.patch.yml del perfil>
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: node tools/quitar-preferencia-perfil.mjs <cordis.patch.yml del perfil>');
  process.exit(2);
}

const original = fs.readFileSync(file, 'utf8');
fs.writeFileSync(`${file}.antes-de-la-prueba`, original);

const lines = original.split('\n');
const out = [];
let removed = 0;
for (let i = 0; i < lines.length; i++) {
  // Bloque a quitar: el comentario y las cuatro líneas del override `- id: locale`.
  if (/^# Idioma de la interfaz:/.test(lines[i])) {
    removed += 5;
    i += 4;
    continue;
  }
  out.push(lines[i]);
}

if (removed === 0) {
  console.error('No encontré el bloque de preferencia de idioma; no se cambió nada.');
  process.exit(1);
}

const next = out.join('\n').replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(`${file}.tmp`, next, 'utf8');
fs.renameSync(`${file}.tmp`, file);
console.log(`quitadas ${removed} líneas. Contenido nuevo:`);
console.log(next);
