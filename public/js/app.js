/**
 * Funciones globales de la aplicación
 * Tomodachi POS System
 */

/**
 * Verificar sesión activa
 */
async function checkSession() {
    try {
        const response = await API.get('/api/auth/verify_session.php');
        
        if (response.success && response.data.logged_in) {
            return response.data.user;
        }
        
        return null;
    } catch (error) {
        console.error('Error al verificar sesión:', error);
        return null;
    }
}

/**
 * Cerrar sesión
 */
async function logout() {
    try {
        const response = await API.post('/api/auth/logout.php');
        
        if (response.success) {
            window.location.href = '/Tomodachi/public/login.html';
        }
    } catch (error) {
        console.error('Error al cerrar sesión:', error);
    }
}

/**
 * Mostrar notificación
 */
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Sidebar toggle (mobile)
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarClose = document.querySelector('.sidebar-close');
    const overlay = document.getElementById('sidebarOverlay');
    const body = document.body;
    
    const closeSidebar = () => {
        sidebar && sidebar.classList.remove('open');
        overlay && overlay.classList.remove('show');
        body.classList.remove('no-scroll');
    };
    
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            const isSmall = window.innerWidth <= 860;
            sidebar.classList.toggle('open');
            const isOpen = sidebar.classList.contains('open');
            if (overlay && isSmall) {
                overlay.classList.toggle('show', isOpen);
            }
            if (isSmall) {
                body.classList.toggle('no-scroll', isOpen);
            }
        });
    }
    
    // Botón de cerrar en el sidebar
    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }
    
    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }
    
    // Cerrar sidebar al hacer clic en un nav-item
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 860) {
                closeSidebar();
            }
        });
    });
    
    // Auto reset on resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 860) {
            overlay && overlay.classList.remove('show');
            body.classList.remove('no-scroll');
            sidebar && sidebar.classList.remove('open');
        }
    });
});

/**
 * Formatear moneda
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount);
}

/**
 * Formatear fecha
 */
function formatDate(date) {
    return new Intl.DateTimeFormat('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(date));
}

/**
 * Validar formulario
 */
function validateForm(formElement) {
    const inputs = formElement.querySelectorAll('[required]');
    let isValid = true;
    
    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.classList.add('error');
            isValid = false;
        } else {
            input.classList.remove('error');
        }
    });
    
    return isValid;
}
