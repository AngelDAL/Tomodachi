/* ============================================================
 * thermal-print.js — Impresión de ticket estilo térmico ESC/POS
 *
 * Genera un ticket HTML optimizado para impresoras térmicas
 * (80mm o 58mm, fuente monospace, ancho de línea ajustado),
 * con QR del ticket, logo opcional y copias.
 *
 * Preferencias (localStorage):
 *   tomodachi_ticket_width : '80' | '58'  (default '80')
 *   tomodachi_ticket_copies: número entero (default 1)
 *
 * Uso:
 *   printThermalTicket({
 *     sale_id, date, store_name, cashier,
 *     items: [{product_name, quantity, unit_price, total}],
 *     subtotal, discount, tax, total, payment_method,
 *     cash_received, change
 *   });
 * ============================================================ */

function getTicketPrefs() {
    let width = '80';
    let copies = 1;
    try {
        width = localStorage.getItem('tomodachi_ticket_width') || '80';
        copies = parseInt(localStorage.getItem('tomodachi_ticket_copies') || '1', 10) || 1;
    } catch (e) {}
    if (width !== '58' && width !== '80') width = '80';
    if (copies < 1) copies = 1;
    if (copies > 5) copies = 5;
    return { width, copies };
}

function methodLabel(m) {
    return { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', mixed: 'Mixto' }[m] || m;
}

/**
 * Genera el HTML del ticket térmico.
 */
function buildThermalTicketHTML(data, prefs) {
    const is58 = prefs.width === '58';
    const pageWidth = is58 ? '58mm' : '80mm';
    const maxChars = is58 ? 32 : 42;

    const storeName = data.store_name || localStorage.getItem('tomodachi_store_name') || 'Tomodachi';
    const dateStr = data.date || new Date().toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    // Línea separadora
    const sep = '-'.repeat(maxChars);

    // Productos
    const rows = (data.items || []).map(it => {
        const name = String(it.product_name || 'Producto');
        const qty = formatQty(it.quantity);
        const lineTotal = it.total != null ? it.total : (it.unit_price * it.quantity);
        const left = `${qty} ${name}`.slice(0, maxChars - 9);
        const right = `$${Number(lineTotal).toFixed(2)}`.padStart(9);
        return `<div class="t-row">${escTicket(left)}<span class="t-right">${right}</span></div>`;
    }).join('');

    // Totales
    const subtotal = data.subtotal != null ? data.subtotal : (data.total || 0);
    const discount = data.discount || 0;
    const tax = data.tax || 0;
    const total = data.total || 0;

    let totalsHtml = '';
    if (data.subtotal != null) totalsHtml += totalRow('Subtotal', subtotal, maxChars);
    if (discount > 0) totalsHtml += totalRow('Descuento', -discount, maxChars);
    if (tax > 0) totalsHtml += totalRow('Impuesto', tax, maxChars);
    totalsHtml += `<div class="t-row t-total">${'TOTAL'.padEnd(maxChars - 9)}<span class="t-right">$${Number(total).toFixed(2)}</span></div>`;

    if (data.cash_received != null) {
        totalsHtml += totalRow('Recibido', data.cash_received, maxChars);
        totalsHtml += totalRow('Cambio', -(data.change || 0), maxChars);
    }
    if (data.payment_method) {
        totalsHtml += `<div class="t-row">${(`Pago: ${methodLabel(data.payment_method)}`).slice(0, maxChars)}</div>`;
    }

    // QR payload
    const qrPayload = data.qr_payload || `TOMODISALE|${data.sale_id || ''}`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Ticket #${data.sale_id || ''}</title>
<style>
    @page { size: ${pageWidth} auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
        font-family: 'Courier New', 'Courier', monospace;
        font-size: ${is58 ? '10px' : '12px'};
        width: ${pageWidth};
        margin: 0 auto;
        padding: 4mm 3mm;
        color: #000;
        background: #fff;
    }
    .t-center { text-align: center; }
    .t-store { font-size: ${is58 ? '13px' : '15px'}; font-weight: bold; margin-bottom: 2px; }
    .t-sub { font-size: ${is58 ? '8px' : '9px'}; }
    .t-row { display: flex; justify-content: space-between; white-space: nowrap; }
    .t-right { text-align: right; }
    .t-total { font-weight: bold; font-size: ${is58 ? '12px' : '14px'}; margin-top: 3px; border-top: 1px dashed #000; padding-top: 3px; }
    .t-sep { text-align: center; letter-spacing: -1px; margin: 3px 0; }
    .t-thanks { text-align: center; margin-top: 6px; }
    .t-qr { text-align: center; margin: 6px 0; }
    .t-qr canvas, .t-qr img { width: ${is58 ? '60px' : '80px'} !important; height: ${is58 ? '60px' : '80px'} !important; }
    .t-copy { text-align: center; font-size: ${is58 ? '7px' : '8px'}; margin-top: 2px; }
</style>
</head>
<body>
    <div class="t-center">
        <div class="t-store">${escTicket(storeName)}</div>
        <div class="t-sub">Ticket de Venta</div>
    </div>
    <div class="t-sep">${sep}</div>
    <div class="t-row"><span>Fecha: ${escTicket(dateStr)}</span></div>
    <div class="t-row"><span>Venta #: ${data.sale_id || '-'}</span></div>
    ${data.cashier ? `<div class="t-row"><span>Cajero: ${escTicket(data.cashier)}</span></div>` : ''}
    <div class="t-sep">${sep}</div>
    ${rows}
    <div class="t-sep">${sep}</div>
    ${totalsHtml}
    <div class="t-qr" id="ticketQr"></div>
    <div class="t-thanks">¡Gracias por su compra!</div>
    <div class="t-copy">Tomodachi POS</div>
</body>
</html>`;
}

function totalRow(label, amount, maxChars) {
    const l = label.slice(0, maxChars - 10);
    const sign = amount < 0 ? '-' : '';
    const r = `${sign}$${Math.abs(Number(amount)).toFixed(2)}`.padStart(9);
    return `<div class="t-row">${escTicket(l)}<span class="t-right">${r}</span></div>`;
}

function escTicket(s) {
    const div = document.createElement('div');
    div.textContent = String(s ?? '');
    return div.innerHTML;
}

function formatQty(q) {
    const n = Number(q);
    if (Number.isNaN(n)) return String(q ?? '');
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Abre ventana e imprime el ticket térmico (con QR y copias).
 * Devuelve true si se lanzó; false si popups bloqueados.
 */
function printThermalTicket(data) {
    const prefs = getTicketPrefs();
    const win = window.open('', 'PrintTicket', 'width=400,height=600');
    if (!win) {
        if (typeof showNotification === 'function') {
            showNotification('Habilita pop-ups para imprimir ticket', 'warning');
        }
        return false;
    }

    const html = buildThermalTicketHTML(data, prefs);
    win.document.open();
    win.document.write(html);
    win.document.close();

    // Generar QR dentro de la ventana (usa qrcodejs global si está cargado)
    const qrPayload = data.qr_payload || `TOMODISALE|${data.sale_id || ''}`;
    win.document.addEventListener('DOMContentLoaded', () => {
        const qrEl = win.document.getElementById('ticketQr');
        if (qrEl && typeof win.QRCode === 'function') {
            try {
                new win.QRCode(qrEl, {
                    text: qrPayload,
                    width: prefs.width === '58' ? 60 : 80,
                    height: prefs.width === '58' ? 60 : 80,
                    correctLevel: win.QRCode.CorrectLevel.M
                });
            } catch (e) { console.warn('QR no generado:', e); }
        }
    });

    win.onload = function () {
        // Esperar un instante para que el QR (si aplica) se dibuje
        setTimeout(() => {
            for (let i = 0; i < prefs.copies; i++) {
                win.focus();
                win.print();
                if (i < prefs.copies - 1) {
                    // Pequeña pausa entre copias
                    const waitUntil = Date.now() + 400;
                    while (Date.now() < waitUntil) {}
                }
            }
            setTimeout(() => win.close(), 300);
        }, 350);
    };

    return true;
}

// Exponer global
window.printThermalTicket = printThermalTicket;
window.buildThermalTicketHTML = buildThermalTicketHTML;
window.getTicketPrefs = getTicketPrefs;
