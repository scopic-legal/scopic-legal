#!/usr/bin/env node
/**
 * Bundles the Scopic server (apps/suzielaw/src/index.ts) into a single ESM
 * file (apps/suzielaw/dist/server.mjs) that electron-builder can package
 * without needing to traverse pnpm's junction-based node_modules.
 *
 * Why ESM output (.mjs)?  The server source (and several @teamsuzie packages)
 * use import.meta.url to derive __dirname.  That expression is silently empty
 * in a CJS bundle, which breaks path resolution at runtime.  A .mjs file is
 * treated as ESM by Node regardless of the package.json "type" field.
 *
 * Native addons and optional DB dialect packages that cannot be inlined are
 * marked external and must be present in the app's root node_modules at
 * runtime.  electron-builder rebuilds them for the packaged Electron version.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await build({
  entryPoints: [path.join(root, 'apps/suzielaw/src/index.ts')],
  bundle: true,
  platform: 'node',
  // ESM keeps import.meta.url semantics intact — required by the server source.
  format: 'esm',
  outfile: path.join(root, 'apps/suzielaw/dist/server.mjs'),
  external: [
    // ── Native C++ addons (cannot be bundled) ──────────────────────────────
    'better-sqlite3',
    'sqlite-vec',
    // ── Sequelize optional dialect drivers ────────────────────────────────
    // Sequelize ships code for every database but only loads the driver that
    // matches the configured dialect.  We use SQLite (via better-sqlite3), so
    // the rest are dead code.  Mark them external so esbuild doesn't error
    // when they're absent from node_modules.
    'pg',
    'pg-native',
    'pg-hstore',
    'mysql',
    'mysql2',
    'mariadb',
    'tedious',      // mssql
    'oracledb',
    'ibm_db',
    'sqlite3',      // not used — we use better-sqlite3 directly
    // ── Other known optional / platform-specific deps ────────────────────
    'fsevents',     // macOS-only; absent on Windows/Linux
  ],
  logLevel: 'info',
});

console.log('[bundle-server] apps/suzielaw/dist/server.mjs written successfully.');
