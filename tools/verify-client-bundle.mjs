/**
 * Verifica el bundle de cliente de `locale-es` contra el corpus extraído.
 *
 * Uso: node tools/verify-client-bundle.mjs
 *
 * No necesita DeepSeek Harness instalado: la raíz del repositorio se deduce de la ubicación de este
 * script (`tools/`), el bundle se lee de `<repo>/locale-es/client.js` y el corpus de
 * `<repo>/tools/corpus/corpus.json`. Se puede correr desde cualquier clon del repositorio y es la
 * comprobación que corre el CI.
 *
 * Qué comprueba:
 *   1. el contrato del cargador de módulos del cliente (una sola llamada a load());
 *   2. la activación del plugin contra un servicio `locale` simulado;
 *   3. que cada clave del corpus se resuelva en español (cadena es -> en) y conserve sus
 *      `{marcadores}`.
 *
 * Sale con código 0 e imprime PASS si todo está bien, o con código 1 e imprime FAIL si algo falla.
 * Las seis líneas de resumen y la de PASS están citadas literalmente en docs/VERIFICACION.md: no
 * cambies su texto.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio: este script vive en `<repo>/tools/`. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const bundleFile = path.join(repoRoot, 'locale-es', 'client.js');
const corpusFile = path.join(repoRoot, 'tools', 'corpus', 'corpus.json');

const code = fs.readFileSync(bundleFile, 'utf8');
const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// 0. Invariante de diseño: el patch del paquete no declara un valor por defecto de `preference`.
//    La preferencia la escribe el cliente por la vía de settings; si el bundle declarara el mismo
//    valor, el perfil quedaría con un valor idéntico al heredado y la aplicación lo descartaría al
//    reescribir su patch (que es justo lo que dejaba la interfaz en inglés).
const patchText = fs.readFileSync(path.join(repoRoot, 'locale-es', 'cordis.patch.yml'), 'utf8');
check(!/^\s*preference:/m.test(patchText), 'locale-es/cordis.patch.yml no debe declarar preference: (ver docs/DESARROLLO.md)');

// 1. Contrato del cargador de módulos del navegador: una sola llamada a load() cuyo factory
//    devuelve el plugin.
let entry = null;
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(candidate) {
        if (entry) throw new Error('el bundle se registró dos veces');
        entry = candidate;
      },
    },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
check(entry !== null, 'el bundle no llamó a window.__ModuleLoader__.load');
if (entry) {
  check(entry.id === '@local/dsh-locale-es', `id de módulo inesperado: ${entry.id}`);
  check(typeof entry.factory === 'function', 'factory no es una función');
  // El cargador envuelve los factories en un contexto con require(); un plugin de solo datos no
  // necesita ninguna dependencia.
  const module = entry.factory(() => { throw new Error('el bundle pidió un módulo inesperado'); });
  check(module.inject?.includes('locale'), 'el plugin no inyecta el servicio locale');
  check(typeof module.apply === 'function', 'el plugin no tiene apply()');

  // 2. Activación: se maneja el servicio `locale` con un doble de prueba y se capturan todos los
  //    registros que hace el plugin, incluida la auto-selección del idioma.
  const activate = (config) => {
    const languages = [];
    const dictionaries = new Map();
    const effects = [];
    const setLocaleCalls = [];
    const locale = {
      addLanguage(language) { languages.push(language); return () => {}; },
      register(ns, id, dict) {
        if (dictionaries.has(`${ns}\u0000${id}`)) throw new Error(`registro duplicado ${ns}/${id}`);
        dictionaries.set(`${ns}\u0000${id}`, dict);
        return () => {};
      },
      setLocale(id) { setLocaleCalls.push(id); },
      getLocale() { return { active: 'en' }; },
    };
    const ctx = {
      locale,
      effect(fn, label) { effects.push({ label, dispose: fn() }); return () => {}; },
    };
    module.apply(ctx, config);
    return { languages, dictionaries, effects, setLocaleCalls };
  };

  const { languages, dictionaries, effects, setLocaleCalls } = activate();

  check(languages.length === 1, `se esperaba una sola llamada a addLanguage, hubo ${languages.length}`);
  check(languages[0]?.id === 'es', `id de idioma inesperado: ${languages[0]?.id}`);
  check(languages[0]?.label === 'Español', `etiqueta de idioma inesperada: ${languages[0]?.label}`);
  check(languages[0]?.fallback === 'en', `respaldo inesperado: ${languages[0]?.fallback}`);
  // La auto-selección es lo que deja la preferencia escrita en el perfil (autorreparable).
  check(setLocaleCalls.includes('es'), 'apply() no fijó el idioma con setLocale("es")');
  // `preference: false` en la config de la fila desactiva esa auto-selección.
  const disabled = activate({ preference: false });
  check(disabled.setLocaleCalls.length === 0, 'preference: false no desactivó la auto-selección del idioma');

  // 3. Búsqueda de textos igual que la hace LocaleRuntime: cadena es -> en, por namespace.
  const lookup = (ns, key, active) => {
    const chain = active === 'es' ? ['es', 'en'] : ['en'];
    for (const id of chain) {
      const dict = dictionaries.get(`${ns}\u0000${id}`);
      const value = dict?.[key];
      if (value !== undefined) return value;
    }
    return undefined;
  };

  let missing = 0;
  let englishLeak = 0;
  const placeholders = (s) => (String(s).match(/\{[A-Za-z0-9_.]+\}/g) ?? []).sort().join(',');
  for (const ns of corpus) {
    if (!dictionaries.has(`${ns.ns}\u0000es`)) { failures.push(`namespace sin registrar: ${ns.ns}`); continue; }
    for (const [key, en] of Object.entries(ns.entries)) {
      const value = lookup(ns.ns, key, 'es');
      if (value === undefined) { missing++; failures.push(`clave sin resolver tras el respaldo: ${ns.ns}#${key}`); continue; }
      if (placeholders(en) !== placeholders(value)) failures.push(`marcadores distintos: ${ns.ns}#${key} (${en} -> ${value})`);
      if (value === en && en.trim() !== '') englishLeak++;
    }
  }
  console.log(`registered locales: ${languages.length}`);
  console.log(`registered dictionaries: ${dictionaries.size}`);
  console.log(`effects registered: ${effects.length}`);
  console.log(`corpus namespaces: ${corpus.length}`);
  console.log(`unresolved keys: ${missing}`);
  console.log(`identical-to-English keys: ${englishLeak}`);
}

console.log('---');
if (failures.length > 0) {
  console.log(`FAIL (${failures.length})`);
  for (const f of failures.slice(0, 20)) console.log(' -', f);
  process.exitCode = 1;
} else {
  console.log('PASS: bundle contract, activation, and full es coverage verified');
}
