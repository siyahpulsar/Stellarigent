const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

// .env dosyasından PORT oku — sunucuyla tutarlı olması için
const dotenvPath = path.join(__dirname, '..', '.env');
let AGENT_PORT = 3000;
try {
  if (fs.existsSync(dotenvPath)) {
    const envLines = fs.readFileSync(dotenvPath, 'utf-8').split('\n');
    for (const line of envLines) {
      const match = line.match(/^PORT\s*=\s*(\d+)/);
      if (match) { AGENT_PORT = parseInt(match[1], 10); break; }
    }
  }
} catch (e) {
  console.warn('[main.js] .env okunurken hata:', e.message);
}

let mainWindow;
let serverProcess = null;

function checkServer(port, callback) {
  const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
    callback(true);
  });
  req.on('error', () => {
    callback(false);
  });
  req.end();
}

function startServer(callback) {
  checkServer(AGENT_PORT, (isRunning) => {
    if (isRunning) {
      console.log(`Server is already running on port ${AGENT_PORT}`);
      callback();
    } else {
      console.log('Starting server.js...');
      serverProcess = spawn(/^win/.test(process.platform) ? 'npm.cmd' : 'npm', ['start'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        shell: true
      });
      // Poll until server is ready (max 30s, every 500ms)
      let attempts = 0;
      const poll = () => {
        checkServer(AGENT_PORT, (ready) => {
          if (ready) {
            callback();
          } else if (attempts++ < 60) {
            setTimeout(poll, 500);
          } else {
            console.error(`Server did not start within 30 seconds on port ${AGENT_PORT}.`);
            callback(); // proceed anyway, window will show error
          }
        });
      };
      setTimeout(poll, 800); // Give node a moment to start
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true // Ensures CSP is enforced
    }
  });

  // index.html'i yükleme: port bilgisini query param olarak geçiriyoruz.
  // ide.js bu parametreyi window.AGENT_PORT olarak okuyacak.
  const indexPath = path.join(__dirname, 'index.html');
  mainWindow.loadURL(`file://${indexPath}?agentPort=${AGENT_PORT}`);

  // Simple menu: File, Edit, Help
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder',
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            if (!canceled) {
              mainWindow.webContents.send('opened-folder', filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Stellarigent IDE',
              message: 'Stellarigent Desktop IDE\nVersion 1.0.0'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer(() => {
    createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    // Kill the entire process group to prevent orphans
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
      } else {
        process.kill(-serverProcess.pid, 'SIGTERM');
      }
    } catch(e) {}
  }
});

// IPC Handlers for file system
ipcMain.handle('read-dir', (event, dirPath) => {
  try {
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    return files.map(f => ({
      name: f.name,
      isDirectory: f.isDirectory(),
      path: path.join(dirPath, f.name)
    })).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (e) {
    console.error(e);
    return [];
  }
});

ipcMain.handle('read-file', (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(e);
    return null;
  }
});

ipcMain.handle('write-file', (event, filePath, content) => {
  try {
    const resolved = path.resolve(filePath);
    
    // Simple directory traversal protection: ensure we are writing inside a valid workspace
    // Normally we should check if resolved path is inside an allowed workspace root.
    // For now, we block writes to sensitive OS directories very strictly.
    const blockedPrefixes = [
      path.resolve('C:\\Windows'),
      path.resolve('C:\\Program Files'),
      path.resolve('C:\\Program Files (x86)'),
      '/etc', '/usr', '/bin', '/sbin', '/boot', '/System', '/Library'
    ];
    
    if (blockedPrefixes.some(blocked => resolved.toLowerCase().startsWith(blocked.toLowerCase()))) {
      console.error('Write blocked — sensitive system path:', resolved);
      return false;
    }
    
    // Create directory if it doesn't exist
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(resolved, content, 'utf8');
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
});

// Open folder dialog from renderer button
ipcMain.handle('open-folder-dialog', async () => {
  if (!mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!canceled && filePaths[0]) {
    mainWindow.webContents.send('opened-folder', filePaths[0]);
  }
});

// Recursive directory listing for Ctrl+P file search
ipcMain.handle('read-dir-recursive', (event, dirPath) => {
  const results = [];
  const SKIP = new Set(['.git', 'node_modules', '.container', 'dist', 'build', '.cache']);
  const walk = (dir, depth) => {
    if (depth > 7) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const f of entries) {
        if (f.name.startsWith('.') || SKIP.has(f.name)) continue;
        const full = path.join(dir, f.name);
        if (f.isDirectory()) {
          walk(full, depth + 1);
        } else {
          results.push({ name: f.name, path: full });
        }
      }
    } catch(e) {}
  };
  walk(dirPath, 0);
  return results;
});

// Rename file or folder
ipcMain.handle('rename-file', (event, oldPath, newPath) => {
  try {
    fs.renameSync(path.resolve(oldPath), path.resolve(newPath));
    return true;
  } catch (e) {
    console.error('rename-file error:', e);
    return false;
  }
});

// Delete file or folder (recursive for directories)
ipcMain.handle('delete-file', (event, filePath) => {
  try {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }
    return true;
  } catch (e) {
    console.error('delete-file error:', e);
    return false;
  }
});

// Create directory
ipcMain.handle('create-dir', (event, dirPath) => {
  try {
    fs.mkdirSync(path.resolve(dirPath), { recursive: true });
    return true;
  } catch (e) {
    console.error('create-dir error:', e);
    return false;
  }
});

