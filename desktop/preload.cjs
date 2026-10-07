const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('yusuiDesktop', {
  window: action => ipcRenderer.invoke('desktop:window', action),
  onState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  },
  onLoading: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('desktop:loading', listener);
    return () => ipcRenderer.removeListener('desktop:loading', listener);
  },
});
