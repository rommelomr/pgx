#!/usr/bin/env node
import 'dotenv/config';
import pg from 'pg';
import { select, input } from '@inquirer/prompts';
import pc from 'picocolors';
import { renderTable, drawBox } from './table.js';

const { Client, types } = pg;

// Fechas y horas tal cual las entrega Postgres (sin convertirlas a Date de JS)
[1082, 1083, 1114, 1184, 1266].forEach((oid) => types.setTypeParser(oid, (v) => v));

const MAX_ROWS = Number(process.env.PGX_MAX_ROWS) || 500;

const baseConfig = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  ssl: ['true', '1', 'require'].includes((process.env.PGSSL || '').toLowerCase())
    ? { rejectUnauthorized: false }
    : undefined,
};
const initialDb = process.env.PGDATABASE || 'postgres';

let client = null;
let currentDb = null;

// ───────────────────────── Conexión ─────────────────────────

async function connectTo(database) {
  const next = new Client({ ...baseConfig, database });
  next.on('error', (e) => console.error(pc.red(`\n✖ Conexión perdida: ${e.message}`)));
  await next.connect();
  if (client) await client.end().catch(() => {});
  client = next;
  currentDb = database;
}

const q = (text, values) => client.query({ text, values, rowMode: 'array' });

// ───────────────────────── Salida ─────────────────────────

const plural = (n) => `${n} fila${n === 1 ? '' : 's'}`;

function printResult(res) {
  if (res.fields && res.fields.length > 0) {
    console.log(renderTable(res.fields, res.rows.slice(0, MAX_ROWS)));
    let foot = plural(res.rows.length);
    if (res.rows.length > MAX_ROWS) foot += ` (mostrando las primeras ${MAX_ROWS})`;
    console.log(pc.dim(foot));
  } else {
    const n = res.rowCount;
    const extra = n !== null && n !== undefined ? ` · ${plural(n)}` : '';
    console.log(pc.green(pc.bold('✔ OK')) + pc.dim(`  ${res.command ?? ''}${extra}`));
  }
}

function printError(e) {
  console.log(pc.red(pc.bold('✖ ERROR: ')) + pc.red(e.message));
  if (e.detail) console.log(pc.dim('  Detalle: ' + e.detail));
  if (e.hint) console.log(pc.dim('  Pista: ' + e.hint));
}

function banner() {
  const lines = [
    'PGX · Cliente interactivo de PostgreSQL',
    '',
    `Servidor : ${baseConfig.host}:${baseConfig.port}`,
    `Usuario  : ${baseConfig.user}`,
    `BD inicial: ${initialDb}`,
  ];
  console.log('\n' + drawBox(lines) + '\n');
}

const quoteIdent = (s) => `"${s.replace(/"/g, '""')}"`;

// ───────────────────────── Acciones ─────────────────────────

async function listDatabases() {
  const res = await q(`
    SELECT d.datname                                   AS "Base de datos",
           pg_get_userbyid(d.datdba)                   AS "Propietario",
           pg_encoding_to_char(d.encoding)             AS "Codificación",
           CASE WHEN has_database_privilege(d.datname, 'CONNECT')
                THEN pg_size_pretty(pg_database_size(d.datname)) ELSE '-' END AS "Tamaño",
           CASE WHEN d.datname = current_database() THEN '●' ELSE '' END      AS "Actual"
    FROM pg_database d
    WHERE NOT d.datistemplate
    ORDER BY 1`);
  console.log(renderTable(res.fields, res.rows));
  console.log(pc.dim(`${res.rows.length} base${res.rows.length === 1 ? '' : 's'} de datos`));
}

async function useDatabase() {
  const res = await q(`SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY 1`);
  const dbs = res.rows.map((r) => r[0]);
  const choice = await select({
    message: 'Elige la base de datos (USE)',
    pageSize: 15,
    loop: false,
    choices: [
      ...dbs.map((d) => ({ name: d === currentDb ? `${d} ${pc.dim('(actual)')}` : d, value: d })),
      { name: pc.dim('← Volver'), value: null },
    ],
  });
  if (!choice || choice === currentDb) return;
  try {
    await connectTo(choice);
    console.log(pc.green(`✔ Ahora usas la base de datos `) + pc.bold(choice));
  } catch (e) {
    printError(e);
    console.log(pc.dim(`Se mantiene la conexión a ${currentDb}`));
  }
}

async function fetchRelations() {
  const res = await q(`
    SELECT n.nspname AS "Esquema",
           c.relname AS "Nombre",
           CASE c.relkind WHEN 'r' THEN 'tabla' WHEN 'v' THEN 'vista' WHEN 'm' THEN 'vista mat.'
                          WHEN 'p' THEN 'particionada' WHEN 'f' THEN 'foránea' END AS "Tipo",
           CASE WHEN c.reltuples < 0 THEN 0 ELSE c.reltuples::bigint END AS "Filas (aprox.)"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','v','m','p','f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
    ORDER BY 1, 2`);
  return res;
}

async function listTables() {
  const res = await fetchRelations();
  if (res.rows.length === 0) {
    console.log(pc.yellow('Esta base de datos no tiene tablas.'));
    return;
  }
  console.log(renderTable(res.fields, res.rows));
  console.log(pc.dim(`${res.rows.length} objeto${res.rows.length === 1 ? '' : 's'}`));
}

async function describeTable() {
  const rels = (await fetchRelations()).rows;
  if (rels.length === 0) {
    console.log(pc.yellow('Esta base de datos no tiene tablas.'));
    return;
  }
  const choice = await select({
    message: 'Elige la tabla a describir',
    pageSize: 15,
    loop: false,
    choices: [
      ...rels.map(([schema, name, tipo]) => ({
        name: `${schema}.${name} ${pc.dim(`(${tipo})`)}`,
        value: { schema, name },
      })),
      { name: pc.dim('← Volver'), value: null },
    ],
  });
  if (!choice) return;

  const ident = `${quoteIdent(choice.schema)}.${quoteIdent(choice.name)}`;
  const res = await q(
    `
    SELECT a.attnum                                   AS "#",
           a.attname                                  AS "Columna",
           format_type(a.atttypid, a.atttypmod)       AS "Tipo",
           CASE WHEN a.attnotnull THEN 'NO' ELSE 'SÍ' END AS "Nulo",
           COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS "Default",
           CASE WHEN pk.attnum IS NOT NULL THEN 'PK' ELSE '' END AS "Clave"
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN (SELECT conrelid, unnest(conkey) AS attnum
               FROM pg_constraint WHERE contype = 'p') pk
           ON pk.conrelid = a.attrelid AND pk.attnum = a.attnum
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`,
    [ident]
  );
  console.log('\n' + pc.bold(`Tabla ${choice.schema}.${choice.name}`));
  console.log(renderTable(res.fields, res.rows));
  console.log(pc.dim(`${res.rows.length} columna${res.rows.length === 1 ? '' : 's'}`));
}

const EXIT_WORDS = new Set(['exit', 'quit', 'salir', '\\q']);

async function sqlMode() {
  console.log(
    '\n' +
      drawBox([
        `Consola SQL · base de datos: ${currentDb}`,
        'Termina la consulta con ";" (o con una línea vacía).',
        'Escribe "exit" o "\\q" para volver al menú.',
      ])
  );

  while (true) {
    let sql = await input({ message: pc.green(`${currentDb}=>`) });
    if (!sql.trim()) continue;
    if (EXIT_WORDS.has(sql.trim().toLowerCase())) break;

    while (!sql.trim().endsWith(';')) {
      const more = await input({ message: pc.dim(`${' '.repeat(Math.max(currentDb.length - 1, 0))}->`) });
      if (!more.trim()) break;
      sql += '\n' + more;
    }

    const t0 = performance.now();
    try {
      const res = await client.query({ text: sql, rowMode: 'array' });
      const results = Array.isArray(res) ? res : [res]; // varias sentencias → varios resultados
      results.forEach(printResult);
      console.log(pc.dim(`⏱  ${(performance.now() - t0).toFixed(1)} ms`));
    } catch (e) {
      printError(e);
    }
    console.log();
  }
}

// ───────────────────────── Menú principal ─────────────────────────

const ACTIONS = {
  dbs: listDatabases,
  use: useDatabase,
  tables: listTables,
  describe: describeTable,
  sql: sqlMode,
};

async function main() {
  banner();
  try {
    await connectTo(initialDb);
    console.log(pc.green('✔ Conectado a ') + pc.bold(currentDb) + '\n');
  } catch (e) {
    printError(e);
    console.log(pc.dim('\nRevisa PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE (.env o variables de entorno).'));
    process.exit(1);
  }

  while (true) {
    const action = await select({
      message: `${pc.cyan(currentDb)} · ¿Qué quieres hacer?`,
      loop: false,
      choices: [
        { name: 'Listar bases de datos', value: 'dbs', description: 'Muestra todas las bases del servidor' },
        { name: 'Usar una base de datos (USE)', value: 'use', description: 'Cambia la base de datos activa' },
        { name: 'Listar tablas', value: 'tables', description: 'Tablas y vistas de la base actual' },
        { name: 'Describir una tabla', value: 'describe', description: 'Columnas, tipos, nulos, defaults y PK' },
        { name: 'Ejecutar SQL', value: 'sql', description: 'Consola SQL interactiva' },
        { name: 'Salir', value: 'exit' },
      ],
    });

    if (action === 'exit') break;

    console.log();
    try {
      await ACTIONS[action]();
    } catch (e) {
      if (e?.name === 'ExitPromptError') throw e;
      printError(e);
    }
    console.log();
  }

  await client.end().catch(() => {});
  console.log(pc.dim('¡Hasta luego!'));
}

main().catch(async (e) => {
  await client?.end().catch(() => {});
  if (e?.name === 'ExitPromptError') {
    console.log(pc.dim('\n¡Hasta luego!'));
    process.exit(0);
  }
  console.error(pc.red(e?.stack || String(e)));
  process.exit(1);
});
