const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopApi', {
  platform: process.platform,
  getData: () => ipcRenderer.invoke('data:get'),
  setOwned: (id, owned) => ipcRenderer.invoke('collection:set', { id, owned }),
  setManyOwned: (ids, owned) => ipcRenderer.invoke('collection:set-many', { ids, owned }),
  undoCollection: () => ipcRenderer.invoke('collection:undo'),
  redoCollection: () => ipcRenderer.invoke('collection:redo'),
  getCollectionHistoryState: () => ipcRenderer.invoke('collection:history-state'),
  setSkinOwned: (id, owned) => ipcRenderer.invoke('skin-collection:set', { id, owned }),
  setShipStars: (id, stars) => ipcRenderer.invoke('collection:set-stars', { id, stars }),
  syncData: module => ipcRenderer.invoke('data:sync', module),
  setNewsState: (id, patch) => ipcRenderer.invoke('news:set-state', { id, patch }),
  saveEquipmentPreset: preset => ipcRenderer.invoke('preset:save', preset),
  deleteEquipmentPreset: id => ipcRenderer.invoke('preset:delete', id),
  saveFleetPreset: fleet => ipcRenderer.invoke('fleet:save', fleet),
  deleteFleetPreset: id => ipcRenderer.invoke('fleet:delete', id),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  setMailRead: (id, read) => ipcRenderer.invoke('mail:set-read', { id, read }),
  deleteMail: id => ipcRenderer.invoke('mail:delete', id),
  cacheAssets: scope => ipcRenderer.invoke('assets:cache', scope),
  exportData: options => ipcRenderer.invoke('data:export', options),
  importData: () => ipcRenderer.invoke('data:import'),
  backupDatabase: () => ipcRenderer.invoke('data:backup'),
  openExternal: url => ipcRenderer.invoke('external:open', url),
  onSyncProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('sync:progress', listener)
    return () => ipcRenderer.removeListener('sync:progress', listener)
  },
  onDataChanged: callback => {
    const listener = () => callback()
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  }
})
