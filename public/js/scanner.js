/**
 * Módulo de escáner (placeholder cámara + entrada manual)
 */
let qrScannerInstance = null;
let isScanningLocked = false; // Bloqueo para evitar lecturas múltiples

document.addEventListener('DOMContentLoaded', () => {
  const toggleScannerBtn = document.getElementById('toggleScannerBtn');
  const scannerContainer = document.getElementById('scannerContainer');
  const closeScannerOverlayBtn = document.getElementById('closeScannerOverlayBtn'); // Botón flotante nuevo
  const closeScannerContainerBtn = document.getElementById('closeScannerContainerBtn'); // Botón interno nuevo
  
  if (!toggleScannerBtn || !scannerContainer) return; // Si no existe en esta vista, salir.

  // Event listener para el botón principal (toggle)
  toggleScannerBtn.addEventListener('click', () => {
    // En la app nativa: escáner de cámara del sistema (fuera del HTML)
    if (window.TomodachiNative && window.TomodachiNative.isNative) {
      window.TomodachiNative.scanBarcode()
        .then(code => {
          if (code && window.fetchByCode) window.fetchByCode(code);
        })
        .catch(err => {
          console.error('Error escáner nativo:', err);
          if (window.showNotification) showNotification('No se pudo leer el código. Intente de nuevo.', 'error');
        });
      return;
    }
    // En navegador normal: escáner HTML con cámara
    if (scannerContainer.classList.contains('hidden')) {
      startScanner();
    } else {
      stopScanner();
    }
  });

  // Listener para el botón de cierre interno (Mobile/Desktop)
  if (closeScannerContainerBtn) {
      closeScannerContainerBtn.addEventListener('click', stopScanner);
  }

  // Ocultar el overlay pero SEGUIR escaneando en segundo plano: al ocultar
  // se colapsa a un pill reducido; el streaming no se detiene y las lecturas
  // siguen agregando productos normalmente.
  const collapseScannerBtn = document.getElementById('collapseScannerBtn');
  if (collapseScannerBtn) {
    collapseScannerBtn.addEventListener('click', () => {
      const collapsed = scannerContainer.classList.toggle('collapsed');
      collapseScannerBtn.title = collapsed ? 'Mostrar escáner' : 'Ocultar y seguir escaneando';
      collapseScannerBtn.innerHTML = collapsed
        ? '<i class="fas fa-eye"></i>'
        : '<i class="fas fa-eye-slash"></i>';
    });
  }

  // Devuelve el overlay a su estado expandido (se llama al abrir/cerrar)
  function resetCollapse() {
    scannerContainer.classList.remove('collapsed');
    if (collapseScannerBtn) {
      collapseScannerBtn.title = 'Ocultar y seguir escaneando';
      collapseScannerBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
    }
  }

  // ---- Overlay ARRASTRABLE: el usuario lo mueve donde no estorbe -----
  // Todo el contenedor es el "grip"; se excluyen los botones (cerrar/colapsar).
  let dragState = null;
  scannerContainer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // dejar pasar clics en botones
    const rect = scannerContainer.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
    try { scannerContainer.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  scannerContainer.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    // Al moverlo pasamos a coordenadas top/left (anulando el bottom/right base)
    scannerContainer.style.left = (dragState.left + dx) + 'px';
    scannerContainer.style.top = (dragState.top + dy) + 'px';
    scannerContainer.style.right = 'auto';
    scannerContainer.style.bottom = 'auto';
  });
  const endDrag = () => { dragState = null; };
  scannerContainer.addEventListener('pointerup', endDrag);
  scannerContainer.addEventListener('pointercancel', endDrag);

  // Listener para el botón de cierre flotante (Legacy)
  const legacyOverlayBtn = document.getElementById('closeScannerOverlayBtn');
  if (legacyOverlayBtn) {
    legacyOverlayBtn.addEventListener('click', stopScanner);
  }

  function startScanner() {
    document.body.classList.add('scanner-active'); // Activar modo inmersivo CSS
    // Reabrir siempre en estado expandido (nunca arrancar colapsado)
    resetCollapse();
    scannerContainer.classList.remove('hidden');
    
    // Cambiar icono del botón principal por si acaso (aunque se oculta en móvil)
    toggleScannerBtn.innerHTML = '<i class="fas fa-times"></i>';
    toggleScannerBtn.setAttribute('aria-label', 'Cerrar escáner');
    
    // Ocultar galería de productos (Controlado por CSS scanner-active también, pero mantenemos JS por seguridad)
    const productsMain = document.querySelector('.products-main'); // Legacy selector
    const galleryMain = document.querySelector('.gallery-main');
    const searchResults = document.getElementById('searchResults');
    
    if (productsMain) productsMain.classList.add('hidden');
    // if (galleryMain) galleryMain.classList.add('hidden'); // CSS lo maneja mejor ahora

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
                // Cálculo dinámico con validación de tamaño mínimo para evitar error 'qrbox dimension value is 50px'
                const minDimension = Math.min(viewfinderWidth, viewfinderHeight);
                const percentage = 0.7; // 70% del área
                let boxSize = Math.floor(minDimension * percentage);
                
                // Asegurar tamaño mínimo válido (mayor a 50px según librería, pero mejor 150px para usabilidad)
                if (boxSize < 100) {
                    boxSize = Math.max(50, minDimension - 20); // Intentar ajustar al contenedor si es muy pequeño
                }

                // Ajustar si el cálculo supera el viewport (no debería si es 70% de minDimension)
                return {
                    width: boxSize,
                    height: boxSize
                };
            },
            // Sin aspectRatio forzado: dejamos que la cámara use su proporción
            // natural y que CSS ajuste el video (portrait o landscape) al contenedor.
            rememberLastUsedCamera: true
        };
        
        const cameraConfig = { facingMode: 'environment' };
        
        // Pequeño retardo para asegurar que el contenedor es visible y tiene dimensiones
        // Esto evita el error "minimum size of 'config.qrbox' dimension value is 50px"
        setTimeout(() => {
            qrScannerInstance.start(cameraConfig, config, onScanSuccess, onScanError)
              .catch(err => { 
                console.error("Error iniciando escáner:", err); 
                if (window.showNotification) showNotification('No se pudo acceder a la cámara. Verifique permisos.','error'); 
              });
        }, 300);
      } catch (e) {
        console.error(e);
      }
    }
  }

  function stopScanner() {
    document.body.classList.remove('scanner-active'); // Desactivar modo inmersivo

    // Restaurar el overlay a su estado expandido siempre
    resetCollapse();

    if (qrScannerInstance) {
      qrScannerInstance.stop().then(() => {
        qrScannerInstance.clear();
        qrScannerInstance = null;
      }).catch(e=>console.error(e));
    }
    scannerContainer.classList.add('hidden');
    toggleScannerBtn.innerHTML = '<i class="fas fa-barcode"></i>';
    toggleScannerBtn.setAttribute('aria-label', 'Activar escáner');

    // Restaurar vistas
    const productsMain = document.querySelector('.products-main');
    if (productsMain) productsMain.classList.remove('hidden');

    // Remover estilos inline forzados por la librería y la posición de arrastre
    if (scannerContainer) {
        scannerContainer.style.removeProperty('position');
        scannerContainer.style.removeProperty('top');
        scannerContainer.style.removeProperty('height');
        scannerContainer.style.removeProperty('left');
        scannerContainer.style.removeProperty('right');
        scannerContainer.style.removeProperty('bottom');
    }
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
