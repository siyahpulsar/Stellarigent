// setup.js - İlk Kurulum (Setup) Yönetim Modülü
(function() {
  let isSetupComplete = false;
  let setupResolve = null;
  window.setupPromise = new Promise((resolve) => {
    setupResolve = resolve;
  });

  async function checkSetupStatus() {
    const modal = document.getElementById('setup-modal');
    const form = document.getElementById('setup-form');
    const statusMsg = document.getElementById('setup-status-msg');
    const submitBtn = document.getElementById('setup-submit-btn');

    try {
      const res = await fetch('/api/setup/status');
      const data = await res.json();

      if (data && data.isSetupCompleted) {
        // Kurulum daha önce tamamlanmış, modalı gösterme
        isSetupComplete = true;
        if (modal) modal.classList.add('hidden');
        if (setupResolve) setupResolve({ isSetupCompleted: true });
        return;
      }
    } catch (e) {
      console.warn('[SETUP] Status check failed, defaulting to ready:', e);
      if (setupResolve) setupResolve({ isSetupCompleted: true });
      return;
    }

    // Kurulum henüz tamamlanmamış: Modalı göster
    if (modal) {
      modal.classList.remove('hidden');
    }

    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const founderKeyInput = document.getElementById('setup-founder-key');
        const discordTokenInput = document.getElementById('setup-discord-token');
        const founderIdInput = document.getElementById('setup-founder-id');

        const founderKey = founderKeyInput ? founderKeyInput.value.trim() : '';
        const discordToken = discordTokenInput ? discordTokenInput.value.trim() : '';
        const founderDiscordId = founderIdInput ? founderIdInput.value.trim() : '';

        if (!founderKey) {
          showSetupError('Lütfen bir Founder Password (Yönetici Şifresi) belirleyin.');
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = '⏳ Kurulum kaydediliyor...';
        }
        hideSetupError();

        try {
          const res = await fetch('/api/setup/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              founderKey,
              discordToken,
              founderDiscordId
            })
          });

          const result = await res.json();
          if (!res.ok || !result.success) {
            showSetupError(result.message || 'Kurulum sırasında bir hata oluştu.');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Kurulumu Tamamla ve Başlat';
            }
            return;
          }

          // Başarılı: founderKey'i localStorage'a kaydet
          localStorage.setItem('founderKey', founderKey);

          // Modalı kapat
          if (modal) modal.classList.add('hidden');

          // Promise'i çöz ve WebSocket'in başlamasını sağla
          if (setupResolve) {
            setupResolve({ isSetupCompleted: true, founderKey });
          }

          if (typeof window.initWebSocket === 'function') {
            window.initWebSocket();
          }

          if (typeof window.showToast === 'function') {
            window.showToast('✅ Kurulum tamamlandı! Hoş geldiniz.', 'success');
          }
        } catch (err) {
          console.error('[SETUP] Submit error:', err);
          showSetupError('Sunucu ile iletişim kurulurken bir hata oluştu: ' + err.message);
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Kurulumu Tamamla ve Başlat';
          }
        }
      };
    }

    function showSetupError(msg) {
      if (statusMsg) {
        statusMsg.textContent = msg;
        statusMsg.classList.remove('hidden');
      } else {
        alert(msg);
      }
    }

    function hideSetupError() {
      if (statusMsg) {
        statusMsg.textContent = '';
        statusMsg.classList.add('hidden');
      }
    }
  }

  // Sayfa hazır olduğunda çalıştır
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkSetupStatus);
  } else {
    checkSetupStatus();
  }
})();
