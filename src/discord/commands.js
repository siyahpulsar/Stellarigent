const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { state } = require('./state');
const { config } = require('../state');
const { ensureYtdlp, enqueueSong, playNext } = require('./musicPlayer');
const { isAdmin, isAuthorized } = require('./utils');
const { exec } = require('child_process');

const LIBRARY_DIR = path.join(__dirname, '../../library');

function getSimilarity(s1, s2) {
  let longer = s1.toLowerCase();
  let shorter = s2.toLowerCase();
  if (s1.length < s2.length) { longer = s2; shorter = s1; }
  let longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}
function editDistance(s1, s2) {
  let costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

function runLibraryAutoclean() {
  try {
    const files = fs.readdirSync(LIBRARY_DIR);
    const now = Date.now();
    const expiryMs = state.discordState.autocleanDays * 24 * 60 * 60 * 1000;
    files.forEach(file => {
      const filePath = path.join(LIBRARY_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.atimeMs > expiryMs) {
        fs.unlinkSync(filePath);
        console.log(`Autoclean: deleted ${file}`);
      }
    });
  } catch (e) {}
}

async function handleCommand(message, command, args) {
  if (command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle("Stellarigent Discord Bot Help")
      .setColor("#3b82f6")
      .setDescription("Kullanılabilir komutların listesi:")
      .addFields(
        { name: '!play <müzik adı>', value: 'Kütüphanede müzik arar ve çalar. Adminler yeni müzik indirebilir.' },
        { name: '!skip', value: 'Sıradaki şarkıya geçer.' },
        { name: '!pause', value: 'Çalan müziği duraklatır.' },
        { name: '!resume', value: 'Duraklatılan müziği devam ettirir.' },
        { name: '!stop', value: 'Müziği durdurur ve kanaldan ayrılır.' },
        { name: '!queue', value: 'Müzik sırasını listeler.' },
        { name: '!library clean/autoclean/delete', value: 'Kütüphane yönetimi (Sadece Adminler).' },
        { name: '!forcetaskplan', value: 'Agent in zorunlu task listesi planı modunu açar/kapatır (Sadece Adminler).' },
        { name: '!lpm', value: 'Low Parameter Mode (LPM) modunu açar/kapatır (Sadece Adminler).' },
        { name: '!simba', value: 'SiMBA (Searched Memory By AI) modunu açar/kapatır (Sadece Adminler).' },
        { name: '!memorylimit <sayı>', value: 'Maksimum hafıza (memory) sınırını ayarlar (Sadece Adminler).' },
        { name: '!perm', value: 'Yetkilendirme komutu (Kullanımdan kaldırıldı, siteye yönlendirir).' }
      );
    message.reply({ embeds: [embed] });
    return;
  }

  if (command === 'forcetaskplan') {
    if (!isAdmin(message.author.id)) {
      message.reply("❌ Bu komutu sadece adminler kullanabilir.");
      return;
    }
    config.forceTaskPlan = !config.forceTaskPlan;
    
    try {
      const configPath = path.join(__dirname, '../../config', 'config.json');
      let data = {};
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        data = Array.isArray(parsed) ? parsed[0] : parsed;
      }
      data.forceTaskPlan = config.forceTaskPlan;
      fs.writeFileSync(configPath, JSON.stringify([data], null, 2), 'utf-8');
      
      message.reply(`✅ Zorunlu Task Planı modu **${config.forceTaskPlan ? "AÇILDI" : "KAPATILDI"}**.\nAgent bundan sonra her görev için önce 'task_plan' aracı ile plan oluşturmak ${config.forceTaskPlan ? "zorundadır" : "zorunda değildir"}.`);
    } catch (e) {
      message.reply(`❌ Ayar kaydedilirken hata oluştu: ${e.message}`);
    }
    return;
  }

  if (command === 'lpm') {
    if (!isAdmin(message.author.id)) {
      message.reply("❌ Bu komutu sadece adminler kullanabilir.");
      return;
    }
    config.lpmMode = !config.lpmMode;
    
    try {
      const configPath = path.join(__dirname, '../../config', 'config.json');
      let data = {};
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        data = Array.isArray(parsed) ? parsed[0] : parsed;
      }
      data.lpmMode = config.lpmMode;
      fs.writeFileSync(configPath, JSON.stringify([data], null, 2), 'utf-8');
      
      message.reply(`✅ LPM (Low Parameter Mode) **${config.lpmMode ? "AÇILDI" : "KAPATILDI"}**.\nAgent bundan sonra küçük modellere uygun tekli tool sorgulama modunda ${config.lpmMode ? "çalışacaktır" : "çalışmayacaktır"}.`);
    } catch (e) {
      message.reply(`❌ Ayar kaydedilirken hata oluştu: ${e.message}`);
    }
    return;
  }

  if (command === 'simba') {
    if (!isAdmin(message.author.id)) {
      message.reply("❌ Bu komutu sadece adminler kullanabilir.");
      return;
    }
    config.simbaEnabled = !config.simbaEnabled;
    
    try {
      const configPath = path.join(__dirname, '../../config', 'config.json');
      let data = {};
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        data = Array.isArray(parsed) ? parsed[0] : parsed;
      }
      data.simbaEnabled = config.simbaEnabled;
      fs.writeFileSync(configPath, JSON.stringify([data], null, 2), 'utf-8');
      
      message.reply(`✅ SiMBA (Searched Memory By AI) **${config.simbaEnabled ? "AÇILDI" : "KAPATILDI"}**.\nAgent bundan sonra geçmiş görevleri araştırırken ${config.simbaEnabled ? "LLM tabanlı SiMBA kullanacaktır" : "standart Vector/Keyword Search kullanacaktır"}.`);
    } catch (e) {
      message.reply(`❌ Ayar kaydedilirken hata oluştu: ${e.message}`);
    }
    return;
  }

  if (command === 'memorylimit') {
    if (!isAdmin(message.author.id)) {
      message.reply("❌ Bu komutu sadece adminler kullanabilir.");
      return;
    }
    if (args.length === 0 || isNaN(parseInt(args[0], 10))) {
      message.reply(`Hafıza sınırı belirtin. Örnek: \`!memorylimit 1000\` (Şu anki sınır: ${config.memoryLimit || 1000})`);
      return;
    }
    
    config.memoryLimit = parseInt(args[0], 10);
    
    try {
      const configPath = path.join(__dirname, '../../config', 'config.json');
      let data = {};
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        data = Array.isArray(parsed) ? parsed[0] : parsed;
      }
      data.memoryLimit = config.memoryLimit;
      fs.writeFileSync(configPath, JSON.stringify([data], null, 2), 'utf-8');
      
      message.reply(`✅ Maksimum hafıza sınırı **${config.memoryLimit}** olarak güncellendi.`);
    } catch (e) {
      message.reply(`❌ Ayar kaydedilirken hata oluştu: ${e.message}`);
    }
    return;
  }

  if (command === 'perm') {
    message.reply("❌ Discord üzerinden yetkilendirme yapılamaz. Lütfen tüm yetkilendirmeleri web paneli üzerinden gerçekleştirin.");
    return;
  }

  if (!isAuthorized(message.author.id)) {
    message.reply("❌ Bu komutu kullanmak için yetkiniz yok.");
    return;
  }

  if (command === 'play') {
    if (!args.length) {
      message.reply("Lütfen çalınacak müziğin adını girin.");
      return;
    }
    const query = args.join(' ');
    if (query.toLowerCase() === 'lib') {
      if (fs.existsSync(LIBRARY_DIR)) {
        const files = fs.readdirSync(LIBRARY_DIR).filter(f => f.endsWith('.mp3'));
        if (files.length === 0) {
          message.reply("📁 Kütüphane şu an boş.");
        } else {
          const embed = new EmbedBuilder()
            .setTitle("📁 Kütüphanedeki Müzikler")
            .setColor("#10b981")
            .setDescription(files.map((f, i) => `${i + 1}. \`${f}\``).join('\n').substring(0, 4096));
          message.reply({ embeds: [embed] });
        }
      } else {
        message.reply("❌ Kütüphane dizini bulunamadı.");
      }
      return;
    }

    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
      message.reply("Müzik dinlemek için önce bir ses kanalına katılmalısınız.");
      return;
    }
    
    let bestMatch = null;
    let highestSim = 0;
    if (fs.existsSync(LIBRARY_DIR)) {
      const files = fs.readdirSync(LIBRARY_DIR);
      files.forEach(file => {
        const sim = getSimilarity(query, file.replace(/\.[^/.]+$/, ""));
        if (sim > highestSim) {
          highestSim = sim;
          bestMatch = file;
        }
      });
    }

    if (highestSim > 0.7 && bestMatch) {
      enqueueSong(path.join(LIBRARY_DIR, bestMatch), bestMatch, voiceChannel, message);
    } else {
      if (!isAdmin(message.author.id)) {
        message.reply("❌ Bu şarkı kütüphanede bulunamadı. Kütüphane dışından şarkı indirme yetkisi sadece adminlere aittir.");
        return;
      }
      message.reply(`📥 Şarkı kütüphanede bulunamadı, indiriliyor...`);
      try {
        const ytdlp = await ensureYtdlp();
        const safeQuery = query.replace(/["'`$\\&|<>\r\n(){};]/g, '').trim();
        const outputFilename = `download_${Date.now()}.mp3`;
        const outputPath = path.join(LIBRARY_DIR, outputFilename);
        const speedLimitArg = `--limit-rate ${Math.round(state.discordState.connectionSpeedLimit * 1024 * 1024)}`;
        const cmd = `"${ytdlp}" ${speedLimitArg} -x --audio-format mp3 -o "${outputPath}" "ytsearch1:${safeQuery}"`;

        exec(cmd, (error, stdout, stderr) => {
          if (error) {
            message.reply(`❌ İndirme hatası: ${error.message}`);
            return;
          }
          const files = fs.readdirSync(LIBRARY_DIR);
          const downloadedFile = files.find(f => f.startsWith(`download_${outputFilename.split('_')[1].split('.')[0]}`));
          if (downloadedFile) {
            enqueueSong(path.join(LIBRARY_DIR, downloadedFile), query, voiceChannel, message);
          } else {
            message.reply("❌ İndirilen dosya bulunamadı.");
          }
        });
      } catch (err) {
        message.reply(`Hata: ${err.message}`);
      }
    }
  }
  else if (command === 'skip') {
    message.reply("⏭️ Şarkı geçiliyor...");
    playNext(message);
  }
  else if (command === 'pause') {
    if (!state.audioPlayer) { message.reply("❌ Müzik çalar aktif değil."); return; }
    state.audioPlayer.pause();
    message.reply("⏸️ Müzik duraklatıldı.");
  }
  else if (command === 'resume') {
    if (!state.audioPlayer) { message.reply("❌ Müzik çalar aktif değil."); return; }
    state.audioPlayer.unpause();
    message.reply("▶️ Müzik devam ettiriliyor.");
  }
  else if (command === 'stop') {
    state.musicQueue.length = 0;
    state.audioPlayer.stop();
    if (state.currentConnection) {
      state.currentConnection.destroy();
      state.currentConnection = null;
    }
    message.reply("⏹️ Müzik durduruldu, kanaldan çıkıldı.");
  }
  else if (command === 'queue') {
    if (state.musicQueue.length === 0 && !state.currentSong) {
      message.reply("Sıra şu an boş.");
      return;
    }
    let text = state.currentSong ? `🔊 **Şu an çalıyor:** ${state.currentSong.name}\n\n` : '';
    text += state.musicQueue.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    message.reply(text);
  }
  else if (command === 'library') {
    if (!isAdmin(message.author.id)) {
      message.reply("❌ Bu komutu sadece adminler kullanabilir.");
      return;
    }
    const sub = args[0];
    if (sub === 'clean') {
      runLibraryAutoclean();
      message.reply("🧹 Kütüphane temizlendi.");
    } else if (sub === 'delete') {
      const rawInput = args.slice(1).join(' ');
      // SECURITY FIX: Use only the filename (basename) to prevent path traversal attacks
      const fileToDelete = path.basename(rawInput);
      if (!fileToDelete) {
        message.reply("❌ Geçersiz dosya adı.");
        return;
      }
      const filePath = path.join(LIBRARY_DIR, fileToDelete);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        message.reply(`🗑️ ${fileToDelete} silindi.`);
      } else {
        message.reply("Dosya bulunamadı.");
      }
    } else {
      message.reply("Kullanım: `!library clean` veya `!library delete <dosya_adı>`");
    }
  }
}
module.exports = { handleCommand };
