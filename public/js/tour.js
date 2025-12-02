/**
 * Sistema de Tour / Onboarding para Tomodachi POS
 * Usa driver.js
 */

// Cargar estilos de Driver.js
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://cdn.jsdelivr.net/npm/driver.js@1.0.1/dist/driver.css';
document.head.appendChild(link);

// Cargar script de Driver.js
const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/driver.js@1.0.1/dist/driver.js.iife.js';
document.head.appendChild(script);

window.TourSystem = {
    driver: null,
    user: null,
    
    init: function(user) {
        this.user = user;
        // Si el usuario desactivó el onboarding, no hacemos nada
        if (!user || !user.show_onboarding || user.show_onboarding == 0) return;
        
        // Esperar a que driver.js cargue
        script.onload = () => {
            this.driver = window.driver.js.driver;
            // Pequeño delay para asegurar que el DOM esté listo y renderizado
            setTimeout(() => this.startTour(), 1000);
        };
        
        // Si ya estaba cargado (navegación SPA o cache)
        if (window.driver) {
            this.driver = window.driver.js.driver;
            setTimeout(() => this.startTour(), 1000);
        }
    },

    startTour: function() {
        const path = window.location.pathname;
        const pageName = path.split('/').pop();
        const storageKey = 'tomodachi_tour_seen_' + pageName;

        // Si ya vio el tour de esta página, no mostrarlo de nuevo automáticamente
        // A menos que queramos un botón de "Ayuda" que lo fuerce.
        if (localStorage.getItem(storageKey)) return;

        let steps = [];

        if (pageName.includes('dashboard.html')) {
            steps = [
                { element: '.welcome-header', popover: { title: 'Bienvenido a Tomodachi', description: 'Este es tu panel principal donde verás un resumen de tu negocio.' } },
                { element: '.stats-grid', popover: { title: 'Estadísticas en tiempo real', description: 'Visualiza ventas, ganancias y productos bajos en stock al instante.' } },
                { element: '.quick-actions', popover: { title: 'Accesos Rápidos', description: 'Botones para las tareas más comunes: Vender, Inventario, etc.' } },
            ];
        } else if (pageName.includes('sales.html')) {
             steps = [
                { element: '.search-box', popover: { title: 'Este es tu Punto de venta', description: 'Escanea el código de barras o escribe el nombre del producto aquí para agregarlo al carrito.' } },
                { element: '#productGallery', popover: { title: 'Catálogo de productos', description: 'En esta sección podrás ver tus productos, registralos y los podrás ver aqui' } },
                { element: '#cartHandle', popover: { title: 'Ver Carrito', description: 'Haz clic aquí para ver los productos agregados, cambiar cantidades o aplicar descuentos.' } },
                { element: '#btnCheckout', popover: { title: 'Finalizar Venta', description: 'Presiona este botón para procesar el pago y completar la venta.' } }
            ];
        } else if (pageName.includes('inventory.html')) {
            steps = [
               { element: '.inventory-header', popover: { title: 'Gestión de Inventario', description: 'Aquí administras todo tu catálogo de productos.' } },
               { element: '#addProductBtn', popover: { title: 'Paso 1: Registrar Producto', description: 'Haz clic aquí para abrir el formulario y crear un nuevo producto.' } },
               { element: '.inventory-table-container', popover: { title: 'Paso 2: Administrar Lista', description: 'Tus productos aparecerán aquí. Usa los botones de Editar (lápiz) para modificar precios o stock.' } },
               { element: '#btnImportExcel', popover: { title: 'Opción: Importación Masiva', description: 'Si tienes muchos productos, usa esta opción para cargarlos desde un archivo Excel. (Esta en Configuracion de empresa)' } }
           ];
       }

        if (steps.length > 0 && this.driver) {
            const driverObj = this.driver({
                showProgress: true,
                steps: steps,
                nextBtnText: 'Siguiente',
                prevBtnText: 'Anterior',
                doneBtnText: 'Entendido',
                onDestroyed: () => {
                    // Marcar como visto
                    localStorage.setItem(storageKey, 'true');
                }
            });

            driverObj.drive();
        }
    }
};
