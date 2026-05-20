const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let promptedForUpdate = false;

function initAutoUpdater() {
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
    if (promptedForUpdate) return;
    promptedForUpdate = true;
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Yes', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: 'A new version of Scopic is available. Install now?',
    });
    if (result.response === 0) {
      autoUpdater.downloadUpdate().catch((error) => {
        console.error('[updates] Download failed:', error);
      });
    }
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updates] No update available.');
  });
  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updates] Download ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updates] Update downloaded; it will install on next restart:', info.version);
  });
  autoUpdater.on('error', (error) => {
    console.error('[updates] Error:', error);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('[updates] Check failed:', error);
  });
}

module.exports = { initAutoUpdater };
