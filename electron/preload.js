const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File system
  readDir:          (path)             => ipcRenderer.invoke('read-dir', path),
  readFile:         (path)             => ipcRenderer.invoke('read-file', path),
  writeFile:        (path, content)    => ipcRenderer.invoke('write-file', path, content),
  readDirRecursive: (path)             => ipcRenderer.invoke('read-dir-recursive', path),
  renameFile:       (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
  deleteFile:       (filePath)         => ipcRenderer.invoke('delete-file', filePath),
  createDir:        (dirPath)          => ipcRenderer.invoke('create-dir', dirPath),
  // Dialogs
  openFolderDialog: ()                 => ipcRenderer.invoke('open-folder-dialog'),
  // Events
  onOpenedFolder:   (callback)         => ipcRenderer.on('opened-folder', (_event, path) => callback(path))
});
