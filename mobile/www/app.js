const CLOUD_URL = 'https://tomodachi.tabtap.dev';
const STORAGE_KEY = 'tomodachi_server_url';

const input = document.getElementById('serverUrl');
const hint = document.getElementById('hint');

// Pre-rellenar con la última URL usada
try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) input.value = saved;
} catch (e) { /* almacenamiento no disponible */ }

function go(url) {
    if (!url) {
        hint.textContent = 'Escribe la URL de tu servidor.';
        hint.classList.add('error');
        return;
    }
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) {
        normalized = 'https://' + normalized;
    }
    try { localStorage.setItem(STORAGE_KEY, normalized); } catch (e) {}
    window.location.href = normalized;
}

document.getElementById('btnCloud').addEventListener('click', () => go(CLOUD_URL));
document.getElementById('btnConnect').addEventListener('click', () => go(input.value));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(input.value); });
