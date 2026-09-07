const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { state } = require('./state');

const BIN_DIR = path.join(__dirname, '../../bin');

function ensureYtdlp() {
  return new Promise((resolve, reject) => {
    const ytdlpPath = path.join(BIN_DIR, 'yt-dlp.exe');
    if (fs.existsSync(ytdlpPath)) return resolve(ytdlpPath);
    console.log("yt-dlp.exe not found. Downloading...");
    axios({ method: 'get', url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', responseType: 'stream' })
      .then(response => {
        const writer = fs.createWriteStream(ytdlpPath);
        response.data.pipe(writer);
        writer.on('finish', () => resolve(ytdlpPath));
        writer.on('error', reject);
      }).catch(reject);
  });
}

function playNext(msgContext) {
  if (state.musicQueue.length === 0) {
    state.currentSong = null;
    return;
  }
  state.currentSong = state.musicQueue.shift();
  const song = state.currentSong;
  try {
    state.currentConnection = joinVoiceChannel({
      channelId: song.voiceChannel.id,
      guildId: song.voiceChannel.guild.id,
      adapterCreator: song.voiceChannel.guild.voiceAdapterCreator,
    });
    state.currentConnection.subscribe(state.audioPlayer);
    const resource = createAudioResource(fs.createReadStream(song.filePath));
    state.audioPlayer.play(resource);
    song.message.channel.send(`🎶 Çalınıyor: **${song.name}**`);
  } catch (err) {
    if (song.message) song.message.channel.send(`❌ Oynatma hatası: ${err.message}`);
    playNext(null);
  }
}

function enqueueSong(filePath, name, voiceChannel, message) {
  state.musicQueue.push({ filePath, name, voiceChannel, message });
  message.reply(`📝 Sıraya eklendi: **${name}**`);
  if (!state.currentSong) playNext(null);
}

module.exports = { ensureYtdlp, playNext, enqueueSong };
