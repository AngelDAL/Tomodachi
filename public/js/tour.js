/**
 * Bienvenida inicial de Tomodachi POS (Driver.js).
 *
 * Regla invariable: la ve únicamente un administrador y una sola vez por
 * tienda. El estado vive en `stores.onboarding_seen`, no en localStorage, por
 * lo que abrir el sistema desde otro equipo o con otro usuario jamás repite la
 * bienvenida. El servidor reclama el único pase de forma atómica.
 */

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://cdn.jsdelivr.net/npm/driver.js@1.0.1/dist/driver.css';
document.head.appendChild(link);

const script = document.createElement('script');
script.src = 'https://cdn.jsdelivr.net/npm/driver.js@1.0.1/dist/driver.js.iife.js';
document.head.appendChild(script);

window.TourSystem = {
    driver: null,
    user: null,

    async init(user) {
        this.user = user;
        if (!user || String(user.role || '').trim().toLowerCase() !== 'admin') return;

        try {
            // El UPDATE del servidor usa `WHERE onboarding_seen = 0`: si dos
            // navegadores abren a la vez, solo uno recibe el único pase.
            const response = await fetch('../api/users/complete_onboarding.php', {
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();
            if (!response.ok || !result.success || !result.data || !result.data.show) return;
        } catch (error) {
            // Ante un error de red no se muestra una copia no controlada.
            console.error('No se pudo reclamar la bienvenida inicial:', error);
            return;
        }

        const launch = () => {
            this.driver = window.driver && window.driver.js ? window.driver.js.driver : null;
            if (this.driver) setTimeout(() => this.startTour(), 300);
        };

        if (window.driver && window.driver.js) launch();
        else script.addEventListener('load', launch, { once: true });
    },

    stepsForCurrentPage() {
        const pageName = window.location.pathname.split('/').pop();
        if (pageName.includes('dashboard.html')) {
            return [
                { element: '.stats-grid', popover: { title: 'Esto es Tomodachi', description: 'Este es tu panel principal: un resumen de tu negocio en tiempo real.' } },
                { element: '.charts-grid', popover: { title: 'Ventas y ganancias', description: 'Aquí visualizas la evolución de ventas y ganancias.' } },
                { element: '.lists-grid', popover: { title: 'Información clave', description: 'Revisa productos más vendidos y el stock bajo para actuar al instante.' } }
            ];
        }
        if (pageName.includes('sales.html')) {
            return [
                { element: '#searchInput', popover: { title: 'Punto de venta', description: 'Escanea un código o escribe el nombre de un producto para agregarlo al carrito.' } },
                { element: '#productGallery', popover: { title: 'Catálogo', description: 'Aquí ves los productos disponibles para vender.' } },
                { element: '#cartColumn', popover: { title: 'Carrito', description: 'Revisa productos, cantidades y descuentos antes de cobrar.' } },
                { element: '#finalizeSaleBtn', popover: { title: 'Finalizar venta', description: 'Procesa el pago y completa la venta.' } }
            ];
        }
        if (pageName.includes('inventory.html')) {
            return [
                { element: '.inv-controls', popover: { title: 'Inventario', description: 'Desde aquí administras tu catálogo.' } },
                { element: '#addProductBtn', popover: { title: 'Registrar producto', description: 'Abre el formulario para crear un producto.' } },
                { element: '#invResults', popover: { title: 'Administrar lista', description: 'Consulta y edita los productos ya registrados.' } }
            ];
        }
        return [];
    },

    startTour() {
        const steps = this.stepsForCurrentPage();
        if (!steps.length || !this.driver) return;

        this.driver({
            showProgress: true,
            steps,
            nextBtnText: 'Siguiente',
            prevBtnText: 'Anterior',
            doneBtnText: 'Entendido'
        }).drive();
    }
};
