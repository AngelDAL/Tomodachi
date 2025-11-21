/**
 * Módulo de escáner (placeholder cámara + entrada manual)
 */
const toggleScannerBtn = document.getElementById('toggleScannerBtn');
const scannerContainer = document.getElementById('scannerContainer');
let qrScannerInstance = null;

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
    qrScannerInstance = new Html5Qrcode('qr-reader');
    const config = { fps: 10, qrbox: 250, aspectRatio: 1.0, formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.EAN_13 ] };
    qrScannerInstance.start({ facingMode: 'environment' }, config, onScanSuccess, onScanError)
      .catch(err => { console.error(err); showNotification('No se pudo iniciar escáner','error'); });
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
  showNotification('Código leído', 'success');
}

function onScanError(err) {
  // Silencioso para evitar spam en consola
}

// Exponer control opcional
window.stopScanner = stopScanner;
