const CLOUD_URL = 'https://tomodachi.tabtap.dev';
const STORAGE_KEY = 'tomodachi_server_url';

const input = document.getElementById('serverUrl');
const hint = document.getElementById('hint');

// Si ya elegimos servidor antes, ir directo a él (sin pantalla de
// bienvenida). El botón "atrás" de Android vuelve aquí para cambiarlo.
let saved = null;
try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}

if (saved) {
    // Navegar directo; el back de Android regresa a esta pantalla.
    window.location.href = saved;
} else {
    initWelcome();
}

function initWelcome() {
    document.body.classList.remove('boot'); // mostrar UI
    document.getElementById('btnCloud').addEventListener('click', () => go(CLOUD_URL));
    document.getElementById('btnConnect').addEventListener('click', () => go(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(input.value); });
}

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
