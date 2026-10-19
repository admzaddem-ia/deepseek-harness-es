/**
 * Genera el paquete de idioma `locale-es/` a partir del corpus y de los lotes traducidos.
 *
 * Uso: node tools/build-locale-pack.mjs
 *
 * No lleva argumentos ni necesita DeepSeek Harness: la raíz del repositorio se deduce de la
 * ubicación de este script (`tools/`) y todo se lee y se escribe dentro del repositorio.
 *
 * Entradas:
 *   tools/corpus/batches/manifest.json  lotes a unir (los `inFile`/`outFile` son relativos a esa carpeta)
 *   tools/corpus/corpus.json            claves inglesas que deben quedar cubiertas
 * Salidas:
 *   tools/corpus/es.json                diccionario unido (namespace -> clave -> español)
 *   locale-es/                          paquete completo (client.js, index.js, manifiesto, ícono y textos)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio: este script vive en `<repo>/tools/`. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const batchDir = path.join(repoRoot, 'tools', 'corpus', 'batches');
const corpusFile = path.join(repoRoot, 'tools', 'corpus', 'corpus.json');
const esFile = path.join(repoRoot, 'tools', 'corpus', 'es.json');
const pkgDir = path.join(repoRoot, 'locale-es');

/** El manifiesto guarda nombres de archivo relativos a la carpeta de lotes. */
const rutaDeLote = (value) => (path.isAbsolute(value) ? value : path.join(batchDir, value));

const manifest = JSON.parse(fs.readFileSync(path.join(batchDir, 'manifest.json'), 'utf8'));

/** Une la salida de todos los lotes en un único mapa namespace -> clave -> español. */
const es = {};
let keys = 0;
for (const m of manifest) {
  const out = JSON.parse(fs.readFileSync(rutaDeLote(m.outFile), 'utf8'));
  for (const [ns, dict] of Object.entries(out)) {
    es[ns] ??= {};
    for (const [key, value] of Object.entries(dict)) {
      if (Object.hasOwn(es[ns], key)) throw new Error(`clave duplicada ${ns}#${key}`);
      es[ns][key] = value;
      keys++;
    }
  }
}

// `sidebarExcel.language` es el identificador de idioma del visor de planillas, no texto de
// interfaz: se conserva el valor inglés (no se sabe si el renderizador admite español).
es.sidebarExcel.language = 'en';

/** Comprueba que cada namespace extraído tenga su diccionario español completo. */
const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
const gaps = [];
for (const ns of corpus) {
  const dict = es[ns.ns];
  if (!dict) {
    gaps.push(`${ns.ns}: falta el namespace`);
    continue;
  }
  for (const key of Object.keys(ns.entries)) if (!Object.hasOwn(dict, key)) gaps.push(`${ns.ns}#${key}: falta`);
}
if (gaps.length > 0) {
  console.error('INCOMPLETE:', gaps.length, gaps.slice(0, 20).join(', '));
  process.exitCode = 1;
}

fs.mkdirSync(path.join(pkgDir, 'locale'), { recursive: true });
fs.writeFileSync(esFile, JSON.stringify(es, null, 1));

const namespaces = Object.keys(es).sort();
const dictionary = JSON.stringify(es);

const client = `/**
 * Paquete de idioma español (es) para el cliente web de DSH.
 *
 * Registra el idioma "Español" y un diccionario por cada namespace de la interfaz. Las claves sin
 * traducir siguen la cadena de respaldo (es -> en), así que muestran el texto inglés y nunca una
 * clave cruda.
 *
 * Además deja el idioma activo por la vía oficial (\`setLocale\`), que escribe la preferencia en el
 * patch del perfil: de ese modo el español sobrevive a que la aplicación reescriba ese archivo.
 * Con \`preference: false\` en la config de la fila, el paquete solo registra el idioma y no lo
 * selecciona.
 *
 * Generado a partir de los diccionarios ingleses del build instalado; no edites el bloque de datos
 * a mano: regeneralo con tools/build-locale-pack.mjs.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-locale-es',
  factory() {
    /** namespace -> clave -> texto en español. */
    const es = ${dictionary};
    /** Metadata del idioma que se publica en el catálogo. */
    const LANGUAGE = { id: 'es', label: 'Español', fallback: 'en' };
    return {
      inject: ['locale'],
      apply(ctx, config) {
        ctx.effect(() => ctx.locale.addLanguage(LANGUAGE), 'locale-es: language');
        for (const [ns, dict] of Object.entries(es)) {
          ctx.effect(() => ctx.locale.register(ns, LANGUAGE.id, dict), 'locale-es: ' + ns);
        }
        // Auto-selección: escribir la preferencia (incluso si el idioma ya está activo) es lo que
        // la deja persistida en el perfil y la vuelve autorreparable.
        const preferred = config?.preference ?? LANGUAGE.id;
        if (preferred === false) return;
        const id = typeof preferred === 'string' ? preferred : LANGUAGE.id;
        try {
          ctx.locale.setLocale(id);
        } catch (error) {
          console.warn('locale-es: no se pudo fijar el idioma', error);
        }
      },
    };
  },
});
`;
fs.writeFileSync(path.join(pkgDir, 'client.js'), client);

const host = `/** Host half of the Spanish language pack; the Client module owns every dictionary. */
export function apply() {}
`;
fs.writeFileSync(path.join(pkgDir, 'index.js'), host);

fs.writeFileSync(
  path.join(pkgDir, 'package.json'),
  JSON.stringify(
    {
      name: '@local/dsh-locale-es',
      version: '1.0.0',
      private: true,
      description: 'Paquete de idioma español para la interfaz web de DeepSeek Harness',
      icon: './icon.svg',
      type: 'module',
      exports: { '.': './index.js', './client': './client.js', './cordis.patch.yml': './cordis.patch.yml' },
      files: ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg'],
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web', immediately: true, inject: ['@deepseek-ai/dsh-client-locale'] },
      },
    },
    null,
    2,
  ) + '\n',
);

// El patch del paquete SOLO inserta la fila. La preferencia del idioma la escribe el propio cliente
// con setLocale (vía oficial de settings), así que el valor guardado en el perfil nunca coincide con
// el valor heredado del bundle y la aplicación no lo descarta al reescribir su patch.
fs.writeFileSync(path.join(pkgDir, 'cordis.patch.yml'), `# Inserta el paquete del idioma.
# La preferencia (Ajustes → General → Idioma) la fija el propio cliente con setLocale, que la
# escribe en el patch del perfil; por eso este patch no declara ningún valor por defecto.
- insert:
    - id: locale-es
      name: '@local/dsh-locale-es'
`);

fs.writeFileSync(
  path.join(pkgDir, 'locale/en.json'),
  JSON.stringify({ meta: { title: 'Spanish language pack', description: 'Adds Spanish (Español) to the interface language selector' } }, null, 2) + '\n',
);
fs.writeFileSync(
  path.join(pkgDir, 'locale/es.json'),
  JSON.stringify({ meta: { title: 'Paquete de idioma español', description: 'Agrega español (Español) al selector de idioma de la interfaz' } }, null, 2) + '\n',
);

// Ícono monocromo mínimo: la paleta de la bandera de España en un cuadrado redondeado.
fs.writeFileSync(
  path.join(pkgDir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="Español">
  <rect x="2" y="5" width="20" height="14" rx="2.5" fill="#c60b1e"/>
  <rect x="2" y="9" width="20" height="6" fill="#ffc400"/>
</svg>
`,
);

console.log(`namespaces: ${namespaces.length}`);
console.log(`keys: ${keys}`);
console.log(`client.js bytes: ${client.length}`);
console.log('gaps:', gaps.length);
