const fs = require('fs');
const path = require('path');
const { agentState, broadcastTerminal } = require('../state');
const { checkAndRegisterPath } = require('../security');

function getSandboxPath(actualPath) {
  const relativeToCwd = path.relative(agentState.cwd, actualPath);
  if (relativeToCwd.startsWith('..') || path.isAbsolute(relativeToCwd)) {
    return actualPath; // Outside CWD, don't sandbox
  }
  return path.join(agentState.cwd, '.container', relativeToCwd);
}

async function readLocalFile(filePath) {
  const targetPath = path.resolve(agentState.cwd, filePath);
  const sandboxPath = getSandboxPath(targetPath);
  broadcastTerminal(`> [FILE READ] Checking Sandbox: ${sandboxPath} -> Real: ${targetPath}\n`);
  
  if (!checkAndRegisterPath(filePath, false)) {
    broadcastTerminal(`> [BLOCKED] Access to path is restricted: ${filePath}\n`);
    return { success: false, message: "Dosya erişimi güvenlik politikası nedeniyle engellendi." };
  }
  
  try {
    let finalPathToRead = targetPath;
    if (fs.existsSync(sandboxPath)) {
      finalPathToRead = sandboxPath;
    } else if (!fs.existsSync(targetPath)) {
      return { success: false, message: `File does not exist: ${filePath}` };
    }
    const content = await fs.promises.readFile(finalPathToRead, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function writeLocalFile(filePath, content) {
  const targetPath = path.resolve(agentState.cwd, filePath);
  const sandboxPath = getSandboxPath(targetPath);
  broadcastTerminal(`> [FILE WRITE] Sandbox: ${sandboxPath} (Real: ${targetPath})\n`);
  
  if (!checkAndRegisterPath(filePath, true)) {
    broadcastTerminal(`> [BLOCKED] Access to path is restricted: ${filePath}\n`);
    return { success: false, message: "Dosya erişimi güvenlik politikası nedeniyle engellendi." };
  }
  
  try {
    const ext = path.extname(sandboxPath);
    if (!ext) {
      if (!fs.existsSync(sandboxPath)) {
        await fs.promises.mkdir(sandboxPath, { recursive: true });
        return { success: true, message: `Directory created successfully at sandbox ${filePath}` };
      } else {
        return { success: true, message: `Directory already exists at sandbox ${filePath}` };
      }
    } else {
      const dir = path.dirname(sandboxPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.writeFile(sandboxPath, content, 'utf-8');
      return { success: true, message: `File written successfully to sandbox ${filePath}. Pending user approval.` };
    }
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function listLocalDirectory(dirPath) {
  const targetPath = path.resolve(agentState.cwd, dirPath || '.');
  broadcastTerminal(`> [DIRECTORY LIST] ${targetPath}\n`);
  
  if (!checkAndRegisterPath(dirPath || '.', false)) {
    broadcastTerminal(`> [BLOCKED] Access to path is restricted: ${dirPath}\n`);
    return { success: false, message: "Klasör erişimi güvenlik politikası nedeniyle engellendi." };
  }
  
  try {
    if (!fs.existsSync(targetPath)) {
      return { success: false, message: `Directory does not exist: ${dirPath}` };
    }
    const items = await fs.promises.readdir(targetPath);
    const details = await Promise.all(items.map(async name => {
      const itemPath = path.join(targetPath, name);
      try {
        const stats = await fs.promises.stat(itemPath);
        return {
          name,
          type: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size
        };
      } catch (err) {
        return { name, type: 'unknown', size: 0 };
      }
    }));
    return { success: true, items: details };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

module.exports = {
  getSandboxPath,
  readLocalFile,
  writeLocalFile,
  listLocalDirectory
};
