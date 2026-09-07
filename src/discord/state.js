const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../config', 'config.json');
const PERMISSIONS_FILE = path.join(__dirname, '../../config', 'permissions.json');

const state = {
  discordState: {
    online: false,
    admins: [],
    authorizedUsers: [],
    connectionSpeedLimit: 0.7,
    maxLibraryGB: 10,
    autocleanDays: 30
  },
  musicQueue: [],
  currentSong: null,
  activeChannel: null,
  activeStatusMessage: null,
  trackedMessages: [],
  broadcastCallback: null,
  serverCb: null,
  client: null,
  audioPlayer: null,
  currentConnection: null,
  founderDiscordId: process.env.FOUNDER_DISCORD_ID || ""
};

function saveConfig() {
  try {
    const data = [{
      admins: state.discordState.admins,
      connectionSpeedLimit: state.discordState.connectionSpeedLimit,
      maxLibraryGB: state.discordState.maxLibraryGB,
      autocleanDays: state.discordState.autocleanDays
    }];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save config.json:", e);
  }
}

function savePermissions() {
  try {
    const data = [{ authorizedUsers: state.discordState.authorizedUsers }];
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error("Failed to save permissions.json:", e);
  }
}

module.exports = { state, saveConfig, savePermissions };
