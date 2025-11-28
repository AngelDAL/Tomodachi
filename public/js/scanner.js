/**
 * Módulo de escáner (placeholder cámara + entrada manual)
 */
let qrScannerInstance = null;
let isScanningLocked = false; // Bloqueo para evitar lecturas múltiples

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
    toggleScannerBtn.innerHTML = '<i class="fas fa-times"></i>';
    toggleScannerBtn.setAttribute('aria-label', 'Cerrar escáner');
    
    // Ocultar galería de productos
    const productsMain = document.querySelector('.products-main');
    if (productsMain) productsMain.classList.add('hidden');

    if (!qrScannerInstance) {
      try {
        // Mover formatos al constructor para soporte correcto
        const formats = [ 
            Html5QrcodeSupportedFormats.QR_CODE, 
            Html5QrcodeSupportedFormats.CODE_128, 
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF
        ];
        
        qrScannerInstance = new Html5Qrcode('qr-reader', { formatsToSupport: formats, verbose: false });
        
        // Configuración basada en productsEvents.js
        const config = { 
            fps: 10, 
            qrbox: function (viewfinderWidth, viewfinderHeight) {
                // Cálculo dinámico del área de escaneo (70% del lado más pequeño)
                let minEdgePercentage = 0.7;
                let minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
                let qrboxSize = Math.floor(minEdgeSize * minEdgePercentage);
                return {
                    width: qrboxSize,
                    height: qrboxSize
                };
            },
            aspectRatio: 1.0,
            rememberLastUsedCamera: true
        };
        
        const cameraConfig = { facingMode: 'environment' };
        
        qrScannerInstance.start(cameraConfig, config, onScanSuccess, onScanError)
          .catch(err => { 
            console.error("Error iniciando escáner:", err); 
            if (window.showNotification) showNotification('No se pudo acceder a la cámara. Verifique permisos.','error'); 
          });
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
    toggleScannerBtn.innerHTML = '<i class="fas fa-barcode"></i>';
    toggleScannerBtn.setAttribute('aria-label', 'Activar escáner');

    // Mostrar galería de productos
    const productsMain = document.querySelector('.products-main');
    if (productsMain) productsMain.classList.remove('hidden');
  }

  function onScanSuccess(decodedText) {
    if (isScanningLocked) return; // Si está bloqueado, ignorar

    isScanningLocked = true; // Bloquear nuevas lecturas
    
    // Reproducir sonido beep si existe (opcional)
    // const audio = new Audio('assets/sound/beep.mp3'); audio.play().catch(e=>{});

    if (window.fetchByCode) { window.fetchByCode(decodedText); }
    // if (window.showNotification) showNotification('Código leído', 'success'); // Ya lo hace fetchByCode

    // Desbloquear después de 1.5 segundos
    setTimeout(() => {
        isScanningLocked = false;
    }, 1500);
  }

  function onScanError(err) {
    // Silencioso
  }

  // Exponer control opcional
  window.stopScanner = stopScanner;
});
