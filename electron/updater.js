const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

let promptedForUpdate = false;
let checkingForUpdate = false;
let downloadingUpdate = false;
let updateErrorShown = false;
let updateReady = false;

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const UPDATE_FEED = {
  provider: 'github',
  owner: 'ezazahamad2003',
  repo: 'scopic-legal',
};

function setWindowProgress(window, value) {
  if (window && !window.isDestroyed()) {
    window.setProgressBar(value);
  }
}

function updateErrorMessage(error) {
  if (!error) return 'Unknown update error.';
  if (error instanceof Error) return error.message;
  return String(error);
}

function initAutoUpdater(mainWindow) {
  if (!app.isPackaged) {
    console.log('[updates] Skipping update check outside a packaged app.');
    return;
  }

  configureUpdateFeed();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updates] Checking for updates...');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updates] Update available:', info.version);
    downloadingUpdate = true;
    updateErrorShown = false;
    setWindowProgress(mainWindow, 2);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updates] No update available.');
  });
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updates] Download ${Math.round(progress.percent)}%`);
    setWindowProgress(mainWindow, Math.max(0, Math.min(1, progress.percent / 100)));
  });
  autoUpdater.on('update-downloaded', async (info) => {
    downloadingUpdate = false;
    updateReady = true;
    setWindowProgress(mainWindow, -1);
    console.log('[updates] Update downloaded; it will install on next restart:', info.version);
    if (promptedForUpdate) return;
    promptedForUpdate = true;
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Scopic ${info.version} is ready to install.`,
      detail: 'Restart Scopic to finish the update.',
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });
  autoUpdater.on('error', (error) => {
    handleUpdateError(error);
  });

  checkForUpdatesSafely();
  setInterval(checkForUpdatesSafely, UPDATE_CHECK_INTERVAL_MS);

  async function checkForUpdatesSafely() {
    if (checkingForUpdate || downloadingUpdate || updateReady) return;
    checkingForUpdate = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('[updates] Check failed:', error);
    } finally {
      checkingForUpdate = false;
    }
  }

  function handleUpdateError(error) {
    const wasDownloadingUpdate = downloadingUpdate;
    downloadingUpdate = false;
    setWindowProgress(mainWindow, -1);
    console.error('[updates] Error:', error);
    if (!wasDownloadingUpdate || updateErrorShown) return;
    updateErrorShown = true;
    dialog.showErrorBox(
      'Scopic update failed',
      `The update could not be downloaded. Please try again later or download the installer from GitHub.\n\n${updateErrorMessage(error)}`,
    );
  }
}

function configureUpdateFeed() {
  const appUpdateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  if (fs.existsSync(appUpdateConfigPath)) return;

  console.warn(
    `[updates] ${appUpdateConfigPath} is missing; using built-in GitHub update feed.`,
  );
  autoUpdater.setFeedURL(UPDATE_FEED);
}

module.exports = { initAutoUpdater };
