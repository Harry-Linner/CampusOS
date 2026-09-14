import { contextBridge, ipcRenderer } from "electron";
import type { DesktopPetBridge } from "../../../shared/src/desktopPet";

const channel = "campusos:desktop-pet:";
contextBridge.exposeInMainWorld("desktopPet", {
  show: () => ipcRenderer.invoke(`${channel}show`),
  openPanel: () => ipcRenderer.invoke(`${channel}panel:open`),
  closePanel: () => ipcRenderer.invoke(`${channel}panel:close`),
  setPanelView: (view) => ipcRenderer.invoke(`${channel}panel:view`, view),
  getState: () => ipcRenderer.invoke(`${channel}state`),
  saveSettings: (patch) => ipcRenderer.invoke(`${channel}settings:save`, patch),
  dismiss: (id) => ipcRenderer.invoke(`${channel}job:dismiss`, id),
  parseClipboard: () => ipcRenderer.invoke(`${channel}clipboard:parse`),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state);
    ipcRenderer.on(`${channel}changed`, handler);
    return () => ipcRenderer.removeListener(`${channel}changed`, handler);
  },
  submit: (input) => ipcRenderer.invoke(`${channel}submit`, input),
  cancel: (id) => ipcRenderer.invoke(`${channel}cancel`, id),
  retry: (id) => ipcRenderer.invoke(`${channel}retry`, id),
  openReview: (id) => ipcRenderer.invoke(`${channel}review`, id),
  move: (delta) => ipcRenderer.invoke(`${channel}move`, delta)
} satisfies DesktopPetBridge);
