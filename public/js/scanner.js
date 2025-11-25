/**
 * Módulo de escáner (placeholder cámara + entrada manual)
 */
let qrScannerInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  const toggleScannerBtn = document.getElementById('toggleScannerBtn');
  const scannerContainer = document.getElementById('scannerContainer');
  if (!toggleScannerBtn || !scannerContainer) return; // Si no existe en esta vista, salir.

  toggleScannerBtn.addEventListener('click', () => {
    if (scannerContainer.classList.contains('hidden')) {
      startScanner();
    } else {
      stopScanner();
    }
  });

  function startScanner() {
    scannerContainer.classList.remove('hidden');
    toggleScannerBtn.textContent = 'Desactivar Escáner';
    if (!qrScannerInstance) {
      try {
        qrScannerInstance = new Html5Qrcode('qr-reader');
        const config = { fps: 10, qrbox: 250, aspectRatio: 1.0, formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13 ] };
        qrScannerInstance.start({ facingMode: 'environment' }, config, onScanSuccess, onScanError)
          .catch(err => { console.error(err); if (window.showNotification) showNotification('No se pudo iniciar escáner','error'); });
      } catch (e) {
        console.error(e);
      }
    }
  }

  function stopScanner() {
    if (qrScannerInstance) {
      qrScannerInstance.stop().then(() => {
        qrScannerInstance.clear();
        qrScannerInstance = null;
      }).catch(e=>console.error(e));
    }
    scannerContainer.classList.add('hidden');
    toggleScannerBtn.textContent = 'Activar Escáner';
  }

  function onScanSuccess(decodedText) {
    if (window.fetchByCode) { window.fetchByCode(decodedText); }
    if (window.showNotification) showNotification('Código leído', 'success');
  }

  function onScanError(err) {
    // Silencioso
  }

  // Exponer control opcional
  window.stopScanner = stopScanner;
});
