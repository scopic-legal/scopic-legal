const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let promptedForUpdate = false;
let downloadingUpdate = false;
let updateErrorShown = false;

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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updates] Checking for updates...');
  });
  autoUpdater.on('update-available', async (info) => {
    console.log('[updates] Update available:', info.version);
    if (promptedForUpdate || downloadingUpdate) return;
    promptedForUpdate = true;
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Scopic ${info.version} is available.`,
      detail: 'Download it now? You can keep working while the update downloads.',
    });
    if (result.response === 0) {
      downloadingUpdate = true;
      updateErrorShown = false;
      setWindowProgress(mainWindow, 2);
      autoUpdater.downloadUpdate().catch((error) => {
        handleUpdateError(error);
      });
    }
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
    setWindowProgress(mainWindow, -1);
    console.log('[updates] Update downloaded; it will install on next restart:', info.version);
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

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('[updates] Check failed:', error);
  });

  function handleUpdateError(error) {
    downloadingUpdate = false;
    setWindowProgress(mainWindow, -1);
    console.error('[updates] Error:', error);
    if (!promptedForUpdate || updateErrorShown) return;
    updateErrorShown = true;
    promptedForUpdate = false;
    dialog.showErrorBox(
      'Scopic update failed',
      `The update could not be downloaded. Please try again later or download the installer from GitHub.\n\n${updateErrorMessage(error)}`,
    );
  }
}

module.exports = { initAutoUpdater };
