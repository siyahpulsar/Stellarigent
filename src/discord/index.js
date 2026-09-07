const { initDiscordBot } = require('./client');
const { state, saveConfig, savePermissions } = require('./state');
const { updateDiscordStatus, sendDiscordFinalResult, sendChannelMessage, sendApprovalRequest } = require('./agentBridge');

module.exports = {
  initDiscordBot,
  getDiscordState: () => ({
    online: state.discordState.online,
    admins: state.discordState.admins,
    authorizedUsers: state.discordState.authorizedUsers,
    connectionSpeedLimit: state.discordState.connectionSpeedLimit
  }),
  updateDiscordConfig: (speedLimit) => {
    state.discordState.connectionSpeedLimit = speedLimit;
    saveConfig();
    if (state.broadcastCallback) state.broadcastCallback();
  },
  addDiscordAdmin: (adminId) => {
    if (!state.discordState.admins.includes(adminId)) {
      state.discordState.admins.push(adminId);
      saveConfig();
      if (state.broadcastCallback) state.broadcastCallback();
    }
  },
  deleteDiscordAdmin: (index) => {
    if (index >= 0 && index < state.discordState.admins.length) {
      state.discordState.admins.splice(index, 1);
      saveConfig();
      if (state.broadcastCallback) state.broadcastCallback();
    }
  },
  addDiscordUser: (userId) => {
    if (!state.discordState.authorizedUsers.includes(userId)) {
      state.discordState.authorizedUsers.push(userId);
      savePermissions();
      if (state.broadcastCallback) state.broadcastCallback();
    }
  },
  deleteDiscordUser: (index) => {
    if (index >= 0 && index < state.discordState.authorizedUsers.length) {
      state.discordState.authorizedUsers.splice(index, 1);
      savePermissions();
      if (state.broadcastCallback) state.broadcastCallback();
    }
  },
  updateDiscordStatus,
  sendDiscordFinalResult,
  sendChannelMessage,
  sendApprovalRequest
};
