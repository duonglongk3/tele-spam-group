'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// Expose ipcRenderer.invoke trực tiếp cho frontend gọi
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})

// Expose tiện ích khác
contextBridge.exposeInMainWorld('electron', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key) => ipcRenderer.invoke('store:delete', key),
    getAll: () => ipcRenderer.invoke('store:getAll'),
  },
  notification: {
    send: (title, body) => ipcRenderer.invoke('notification:send', { title, body }),
  },
  platform: process.platform,
})
