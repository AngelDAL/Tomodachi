// Cargar logo de la tienda en el sidebar (igual que dashboard)
document.addEventListener('DOMContentLoaded', async () => {
    // Verificar sesión (opcional, si ya existe en otro script, omitir)
    if (typeof checkSession === 'function') {
        const session = await checkSession();
        if (!session) { requireSession(); return; }
    }

    // Cargar logo de la tienda
    try {
        const res = await fetch('../api/stores/settings.php');
        const data = await res.json();
        if (data.success && data.data && data.data.logo_url) {
            const logoImg = document.getElementById('navStoreLogo');
            if (logoImg) {
                logoImg.src = data.data.logo_url;
                logoImg.style.display = 'inline-block';
                if (logoImg.nextElementSibling) {
                    logoImg.nextElementSibling.style.display = 'none';
                }
            }
        }
    } catch (e) {
        // Si falla, dejar el logo por defecto
    }
});
