const { state } = require('./state');
function isAdmin(userId) { return state.discordState.admins.includes(userId); }
function isAuthorized(userId) {
  if (isAdmin(userId)) return true;
  return state.discordState.authorizedUsers.some(u => {
    const cleanId = u.replace(/[<@!>]/g, '');
    return cleanId === userId;
  });
}
module.exports = { isAdmin, isAuthorized };
