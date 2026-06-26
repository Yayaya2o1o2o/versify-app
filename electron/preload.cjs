const { contextBridge, ipcRenderer } = require("electron");

const api = {
  // window
  setMode: (mode) => ipcRenderer.send("set-mode", mode), // "home" | "hud"
  setPos: (x, y) => ipcRenderer.send("set-pos", { x, y }),
  minimize: () => ipcRenderer.send("minimize"),
  quit: () => ipcRenderer.send("quit"),

  // media + pipeline
  micPermission: () => ipcRenderer.invoke("mic-permission"),
  processAudio: (arrayBuffer) => ipcRenderer.invoke("process-audio", arrayBuffer),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("process-progress", handler);
    return () => ipcRenderer.removeListener("process-progress", handler);
  },

  // persistence
  load: (key) => ipcRenderer.invoke("store-load", key),
  save: (key, value) => ipcRenderer.invoke("store-save", { key, value }),

  isElectron: true,
};

contextBridge.exposeInMainWorld("notify", api);
