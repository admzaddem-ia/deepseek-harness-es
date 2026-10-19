/**
 * Extrae el corpus de textos ingleses de los bundles de cliente de DeepSeek Harness.
 *
 * Uso: node tools/extract-corpus.mjs --dir <carpeta> [--out <archivo.json>]
 *      DSH_CLIENT_BUNDLES=<carpeta> node tools/extract-corpus.mjs [--out <archivo.json>]
 *
 * Recorre los archivos `client.js` que hay bajo la carpeta indicada (los que extrae
 * `dsh-asar-extract.mjs` del app.asar), encuentra cada llamada a `locale.register(...)`, resuelve
 * el namespace y el diccionario inglés —incluso cuando están en constantes del propio bundle— y
 * escribe el corpus que consumen `make-batches.mjs` y `verify-client-bundle.mjs`.
 *
 * No necesita DeepSeek Harness instalado: la única entrada es la carpeta con los bundles.
 *
 * Variables de entorno:
 *   DSH_CLIENT_BUNDLES  carpeta con los bundles extraídos (alternativa a `--dir`)
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio: este script vive en `<repo>/tools/`. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const USO = `Uso: node tools/extract-corpus.mjs --dir <carpeta> [--out <archivo.json>]
     DSH_CLIENT_BUNDLES=<carpeta> node tools/extract-corpus.mjs [--out <archivo.json>]

Argumentos:
  --dir <carpeta>    carpeta con los client.js extraídos del app.asar (o DSH_CLIENT_BUNDLES)
  --out <archivo>    destino del corpus (por defecto tools/corpus/corpus.json)
`;

const argv = process.argv.slice(2);
let root;
let outFile = path.join(repoRoot, 'tools', 'corpus', 'corpus.json');

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '-h' || arg === '--help') {
    console.log(USO);
    process.exit(0);
  } else if (arg === '--dir' || arg === '--out') {
    const value = argv[++i];
    if (value === undefined) {
      console.error(`Falta el valor de ${arg}.\n`);
      console.error(USO);
      process.exit(2);
    }
    if (arg === '--dir') root = value;
    else outFile = value;
  } else {
    console.error(`Opción desconocida: ${arg}\n`);
    console.error(USO);
    process.exit(2);
  }
}

root ??= process.env.DSH_CLIENT_BUNDLES;
if (!root) {
  console.error(USO);
  process.exit(2);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`No existe la carpeta de bundles: ${root}`);
  process.exit(2);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'client.js') files.push(p);
  }
})(root);

/** Devuelve el índice del delimitador que cierra al de `openIndex`, ignorando cadenas y comentarios. */
function matchClose(text, openIndex, open, close) {
  let depth = 0;
  let i = openIndex;
  let inStr = null;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i += 2;
      else {
        if (c === inStr) inStr = null;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i); i = end < 0 ? text.length : end + 2; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Separa por comas de primer nivel, respetando llaves, corchetes y cadenas. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += text[++i]; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue; }
    if ('{(['.includes(c)) depth++;
    if ('})]'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.trim());
}

/** nombre -> texto del lado derecho de `const NOMBRE = ...` en el ámbito del módulo. */
function collectBindings(text) {
  const map = new Map();
  const re = /\bconst ([A-Za-z_$][\w$]*) = /g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const after = m.index + m[0].length;
    let rhs;
    const c = text[after];
    if (c === '{' || c === '[') {
      const end = matchClose(text, after, c, c === '{' ? '}' : ']');
      rhs = end < 0 ? '' : text.slice(after, end + 1);
    } else {
      let end = after;
      let depth = 0;
      while (end < text.length) {
        const ch = text[end];
        if ('{(['.includes(ch)) depth++;
        else if ('})]'.includes(ch)) { if (depth === 0) break; depth--; }
        else if (ch === ';' && depth === 0) break;
        else if (ch === '\n' && depth === 0) break;
        end++;
      }
      rhs = text.slice(after, end).trim();
    }
    if (!map.has(name)) map.set(name, rhs);
  }
  return map;
}

/** Resuelve expresiones sencillas (cadenas, identificadores y literales de objeto) del bundle. */
function makeResolver(bindings) {
  const cache = new Map();
  function resolve(expr, seen = new Set()) {
    const e = expr.trim().replace(/;$/, '').trim();
    if (e === '') return undefined;
    if (cache.has(e)) return cache.get(e);
    let out;
    if (/^"/.test(e) || /^'/.test(e)) {
      try { out = new Function(`return ${e}`)(); } catch { out = undefined; }
    } else if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      if (seen.has(e)) return undefined;
      seen.add(e);
      const rhs = bindings.get(e);
      out = rhs === undefined ? undefined : resolve(rhs, seen);
    } else if (/^[{[]/.test(e)) {
      try {
        out = new Function(`return ${e}`)();
      } catch {
        // Literal de objeto cuyos valores son identificadores.
        out = undefined;
        if (e[0] === '{') {
          const inner = e.slice(1, -1);
          const obj = {};
          for (const part of splitTopLevel(inner)) {
            const ci = part.indexOf(':');
            if (ci < 0) {
              // Propiedad abreviada: { zh, en }
              const name = part.trim();
              if (/^[A-Za-z_$][\w$]*$/.test(name)) obj[name] = resolve(name, seen);
              continue;
            }
            let key = part.slice(0, ci).trim();
            if (/^"/.test(key)) key = key.slice(1, -1);
            obj[key] = resolve(part.slice(ci + 1), seen);
          }
          out = obj;
        }
      }
    }
    cache.set(e, out);
    return out;
  }
  return resolve;
}

const namespaces = [];
const unresolved = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const parts = f.split(path.sep);
  const pkg = parts[parts.length - 3];
  const bindings = collectBindings(text);
  const resolve = makeResolver(bindings);

  const re = /locale\.register\(/g;
  let m;
  let found = 0;
  while ((m = re.exec(text))) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchClose(text, openParen, '(', ')');
    if (closeParen < 0) continue;
    const args = splitTopLevel(text.slice(openParen + 1, closeParen));
    const ns = resolve(args[0]);
    if (typeof ns !== 'string' || ns === '') { unresolved.push({ pkg, why: 'ns', expr: (args[0] ?? '').slice(0, 60) }); continue; }
    let dicts = null;
    if (args.length >= 2 && args[1].trim().startsWith('{')) {
      const obj = resolve(args[1]);
      if (obj && typeof obj === 'object' && obj.en) dicts = { en: obj.en, zh: obj.zh };
    } else if (args.length >= 3) {
      const localeId = resolve(args[1]);
      const dict = resolve(args[2]);
      if (localeId === 'en') dicts = { en: dict };
      else if (localeId === 'zh') dicts = { zh: dict };
    }
    if (!dicts || !dicts.en || typeof dicts.en !== 'object') { unresolved.push({ pkg, why: 'dict', ns, expr: (args[1] ?? '').slice(0, 60) }); continue; }
    const entries = {};
    for (const [k, v] of Object.entries(dicts.en)) entries[k] = v;
    namespaces.push({ pkg, ns, count: Object.keys(entries).length, entries });
    found++;
  }
  if (found === 0 && /locale/.test(text)) unresolved.push({ pkg, why: 'no-register' });
}

let total = 0;
for (const n of namespaces) total += n.count;
console.log('namespaces:', namespaces.length, '| claves:', total);
for (const n of namespaces.sort((a, b) => b.count - a.count)) console.log(String(n.count).padStart(5), n.ns, '|', n.pkg);
console.log('--- sin resolver (' + unresolved.length + ') ---');
for (const u of unresolved.slice(0, 40)) console.log(u.pkg, u.why, u.ns ?? '', u.expr ?? '');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(namespaces, null, 1));
console.log(`corpus escrito en: ${outFile}`);
