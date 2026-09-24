const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execSync } = require('child_process');
const { state } = require('./state');

const BIN_DIR = path.join(__dirname, '../../bin');
const LIBRARY_DIR = path.join(__dirname, '../../library');

// library/ klasörünü yoksa otomatik oluştur
if (!fs.existsSync(LIBRARY_DIR)) {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  console.log(`[musicPlayer] library/ klasörü oluşturuldu: ${LIBRARY_DIR}`);
}

// bin/ klasörünü de yoksa oluştur (Windows exe indirme hedefi)
if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

/**
 * Platform uyumlu yt-dlp çözümleyici.
 * - Windows: bin/yt-dlp.exe indirir (yoksa).
 * - Linux/macOS: sistem PATH'inden `yt-dlp` binary'sini arar.
 *   Docker: Dockerfile'da `/usr/local/bin/yt-dlp` zaten mevcut.
 * @returns {Promise<string>} yt-dlp binary yolu
 */
function ensureYtdlp() {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      // Windows: bin/ klasörüne exe indir
      const ytdlpPath = path.join(BIN_DIR, 'yt-dlp.exe');
      if (fs.existsSync(ytdlpPath)) return resolve(ytdlpPath);
      console.log('[musicPlayer] yt-dlp.exe bulunamadı, indiriliyor...');
      axios({
        method: 'get',
        url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
        responseType: 'stream'
      }).then(response => {
        const writer = fs.createWriteStream(ytdlpPath);
        response.data.pipe(writer);
        writer.on('finish', () => resolve(ytdlpPath));
        writer.on('error', reject);
      }).catch(reject);
    } else {
      // Linux/macOS/Docker: PATH'den veya /usr/local/bin'den yt-dlp bul
      const candidates = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return resolve(candidate);
      }
      // PATH üzerinden kontrol
      try {
        const result = execSync('which yt-dlp', { encoding: 'utf-8' }).trim();
        if (result) return resolve(result);
      } catch (e) {}
      // Bulunamadı — kullanıcıya açık hata mesajı
      reject(new Error(
        '[musicPlayer] yt-dlp bulunamadı. Linux/Mac için kurulum: ' +
        'sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp'
      ));
    }
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
