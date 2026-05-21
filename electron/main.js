const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { initAutoUpdater } = require('./updater');

const APP_URL = 'http://localhost:17502';
const FRONTEND_READY_URL = 'http://127.0.0.1:17502';
const BACKEND_HEALTH_URL = 'http://127.0.0.1:17501/api/health';
const PACKAGED_HEALTH_URL = 'http://127.0.0.1:17502/api/health';
const READY_TIMEOUT_MS = 30_000;
const READY_INTERVAL_MS = 500;

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;
let backendError = '';

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

process.on('uncaughtException', (error) => {
  log(`uncaughtException: ${error.stack || error.message}`);
});

process.on('unhandledRejection', (error) => {
  log(`unhandledRejection: ${error && error.stack ? error.stack : String(error)}`);
});

function isDevelopment() {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

function appRoot() {
  return app.getAppPath();
}

function appPath(...segments) {
  return path.join(appRoot(), ...segments);
}

function commandForPnpm() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function quoteForCmd(arg) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["^&|<>])/g, '^$1')}"`;
}

function pnpmSpawnArgs(args) {
  if (process.platform !== 'win32') {
    return { command: commandForPnpm(), args };
  }

  const commandLine = [commandForPnpm(), ...args].map(quoteForCmd).join(' ');
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
}

function childEnv(extra = {}) {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  return {
    ...process.env,
    NODE_ENV: 'development',
    SCOPIC_DB_PATH: path.join(userData, 'scopic.db'),
    ...extra,
  };
}

function spawnLogged(command, args, options) {
  const { name, ...spawnOptions } = options;
  log(`spawning ${name}: ${command} ${args.join(' ')} (cwd=${spawnOptions.cwd})`);
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...spawnOptions,
  });

  child.stdout.on('data', (chunk) => {
    console.log(`[${name}] ${chunk.toString().trimEnd()}`);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    backendError += text;
    console.error(`[${name}] ${text.trimEnd()}`);
    log(`[${name}] stderr: ${text.trimEnd()}`);
  });
  child.on('error', (error) => {
    backendError += `${error.message}\n`;
    log(`[${name}] error: ${error.stack || error.message}`);
  });
  child.on('exit', (code, signal) => {
    log(`[${name}] exit: code=${code} signal=${signal}`);
  });
  return child;
}

function startBackend() {
  const appDir = appPath('apps', 'suzielaw');
  if (isDevelopment()) {
    const pnpm = pnpmSpawnArgs(['exec', 'tsx', 'src/index.ts']);
    backendProcess = spawnLogged(pnpm.command, pnpm.args, {
      cwd: appDir,
      env: childEnv({
        SCOPIC_PORT: '17501',
        SCOPIC_PUBLIC_URL: 'http://localhost:17501',
        SCOPIC_ALLOWED_ORIGIN: APP_URL,
      }),
      name: 'scopic-backend',
    });
    return;
  }

  // server.mjs is the esbuild-produced self-contained ESM bundle (no pnpm junctions).
  const serverEntry = appPath('apps', 'suzielaw', 'dist', 'server.mjs');
  // Bundled content dirs live next to the server inside the packaged app.
  // The dev .env points these at relative paths; in the packaged build there
  // is no .env, so pass absolute paths explicitly or the built-in personas /
  // templates / workflow skills never load (only "Default Counsel" appears).
  const suzielawDir = appPath('apps', 'suzielaw');
  backendProcess = spawnLogged(process.execPath, [serverEntry], {
    cwd: appDir,
    env: childEnv({
      ELECTRON_RUN_AS_NODE: '1',
      SCOPIC_AUTH_BYPASS: 'true',
      SCOPIC_PORT: '17502',
      SCOPIC_PUBLIC_URL: APP_URL,
      SCOPIC_ALLOWED_ORIGIN: APP_URL,
      SCOPIC_PERSONAS_DIR: path.join(suzielawDir, 'personas'),
      SCOPIC_TEMPLATES_DIR: path.join(suzielawDir, 'templates'),
      SCOPIC_SKILLS_DIR: path.join(suzielawDir, 'skills'),
    }),
    name: 'scopic-backend',
  });
}

function startFrontend() {
  if (!isDevelopment()) return;
  const pnpm = pnpmSpawnArgs(['dev', '--host', '127.0.0.1']);
  frontendProcess = spawnLogged(
    pnpm.command,
    pnpm.args,
    {
      cwd: appPath('apps', 'suzielaw', 'client'),
      env: childEnv({
        SCOPIC_PORT: '17501',
        SCOPIC_CLIENT_PORT: '17502',
      }),
      name: 'scopic-client',
    },
  );
}

function waitForUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForReady() {
  const started = Date.now();
  const backendUrl = isDevelopment() ? BACKEND_HEALTH_URL : PACKAGED_HEALTH_URL;
  log(`waiting for backend=${backendUrl} frontend=${FRONTEND_READY_URL}`);

  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (backendProcess?.exitCode !== null) {
      throw new Error(backendError.trim() || 'Backend process exited before startup completed.');
    }
    const backendReady = await waitForUrl(backendUrl);
    const frontendReady = await waitForUrl(FRONTEND_READY_URL);
    if (backendReady && frontendReady) return;
    await new Promise((resolve) => setTimeout(resolve, READY_INTERVAL_MS));
  }

  throw new Error(backendError.trim() || 'Timed out waiting for Scopic to start.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'Scopic',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle('Scopic');
  });
  mainWindow.loadURL(APP_URL);
}

function stopChild(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  child.kill('SIGTERM');
}

app.whenReady().then(async () => {
  try {
    log(`app ready: cwd=${process.cwd()} appPath=${app.getAppPath()} packaged=${app.isPackaged}`);
    startBackend();
    startFrontend();
    await waitForReady();
    log('services ready; creating window');
    createWindow();
    setTimeout(() => initAutoUpdater(mainWindow), 3_000);
  } catch (error) {
    log(`startup failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    dialog.showErrorBox(
      'Scopic failed to start',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  stopChild(frontendProcess);
  stopChild(backendProcess);
});
