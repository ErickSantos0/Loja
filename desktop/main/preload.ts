import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fioDesktop", {
  loadState: () => ipcRenderer.invoke("fio:load"),
  mutate: (body: unknown) => ipcRenderer.invoke("fio:mutate", body),
  getInfo: () => ipcRenderer.invoke("fio:info"),
  setOperator: (name: string) => ipcRenderer.invoke("fio:operator", name),
  backup: () => ipcRenderer.invoke("fio:backup"),
  restoreBackup: () => ipcRenderer.invoke("fio:restore"),
  importWebExport: () => ipcRenderer.invoke("fio:import"),
  printReceipt: () => ipcRenderer.invoke("fio:print"),
  revealData: () => ipcRenderer.invoke("fio:folder"),
  pending: {
    get: () => ipcRenderer.invoke("fio:pending:get"),
    set: (raw: string) => ipcRenderer.invoke("fio:pending:set", raw),
    clear: () => ipcRenderer.invoke("fio:pending:clear"),
  },
});
