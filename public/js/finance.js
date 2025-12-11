async function loadTerminals() {
    const grid = document.getElementById('terminalsGrid');
    try {
        const response = await fetch('../api/terminals/read.php');
        const result = await response.json();
        
        if (!result.success) {
            showNotification(result.error || 'Error al cargar terminales', 'error');
            return;
        }

        const terminals = result.data.terminals;
        grid.innerHTML = '';
        
        let totalCash = 0;
        let openCount = 0;

        terminals.forEach(term => {
            const isOpen = term.terminal_status === 'active' && term.current_register_id;
            const balance = parseFloat(term.current_balance || 0);
            
            if (isOpen) {
                totalCash += balance;
                openCount++;
            }

            const card = document.createElement('div');
            card.className = `terminal-card ${isOpen ? 'open' : 'closed'}`;
            
            let statusBadge = isOpen 
                ? `<span class="terminal-status status-open">ABIERTA</span>` 
                : `<span class="terminal-status status-closed">CERRADA</span>`;

            let content = `
                <div class="terminal-header">
                    <h3>${term.terminal_name}</h3>
                    ${statusBadge}
                </div>
            `;

            if (isOpen) {
                content += `
                    <div class="terminal-info">
                        <div class="info-row">
                            <span>Usuario:</span>
                            <strong>${term.current_user_name || 'Desconocido'}</strong>
                        </div>
                        <div class="info-row">
                            <span>Apertura:</span>
                            <span>${new Date(term.opening_date).toLocaleString()}</span>
                        </div>
                        <div class="amount-display">${formatCurrency(balance)}</div>
                    </div>
                    <div class="terminal-actions">
                        <button class="btn-action btn-movements" onclick="openHistoryDrawer(${term.current_register_id})">
                            <i class="fas fa-list-alt"></i> Movimientos
                        </button>
                        <button class="btn-action btn-close" onclick="openCloseRegisterModal(${term.current_register_id}, '${term.terminal_name}', ${balance})">
                            <i class="fas fa-file-invoice-dollar"></i> Corte
                        </button>
                    </div>
                `;
            } else {
                content += `
                    <div class="terminal-info">
                        <p style="color: #666; font-style: italic;">Caja cerrada. Inicie sesión para comenzar a vender.</p>
                    </div>
                    <div class="terminal-actions">
                        <button class="btn-action btn-open" onclick="openOpenRegisterModal(${term.terminal_id}, '${term.terminal_name}')">
                            <i class="fas fa-lock-open"></i> Abrir Caja
                        </button>
                        <button class="btn-action" style="background: #eee; color: #333;" onclick="deleteTerminal(${term.terminal_id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            }

            card.innerHTML = content;
            grid.appendChild(card);
        });

        document.getElementById('totalCashDisplay').textContent = formatCurrency(totalCash);
        document.getElementById('openTerminalsDisplay').textContent = openCount;

    } catch (error) {
        console.error(error);
        grid.innerHTML = '<p>Error de conexión</p>';
    }
}

// --- Modals (Drawers) ---

let currentHistoryRegisterId = null;

async function openHistoryDrawer(registerId) {
    currentHistoryRegisterId = registerId;
    const drawer = document.getElementById('movementsHistoryDrawer');
    const list = document.getElementById('movementsList');
    const expectedEl = document.getElementById('historyExpectedAmount');
    
    drawer.classList.add('show');
    list.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
    expectedEl.textContent = '...';

    try {
        const res = await fetch(`../api/cash_register/get_movements.php?register_id=${registerId}`);
        const data = await res.json();

        if (data.success) {
            renderMovementsList(data.data.movements, data.data.initial_amount, data.data.opening_date);
        } else {
            list.innerHTML = `<p class="error-msg">${data.error || 'Error al cargar'}</p>`;
        }
    } catch (e) {
        console.error(e);
        list.innerHTML = '<p class="error-msg">Error de conexión</p>';
    }
}

function renderMovementsList(movements, initialAmount, openingDate) {
    const list = document.getElementById('movementsList');
    const expectedEl = document.getElementById('historyExpectedAmount');
    
    // Calcular acumulados (movements vienen en ASC)
    let currentBalance = parseFloat(initialAmount) || 0;
    
    // Agregar evento de apertura al inicio para visualización
    const processedMovements = [{
        type: 'opening',
        amount: currentBalance,
        description: 'Apertura de Caja',
        created_at: openingDate,
        user_name: 'Sistema',
        accumulated: currentBalance
    }];

    if (movements && movements.length > 0) {
        movements.forEach(m => {
            const amount = parseFloat(m.amount);
            if (m.movement_type === 'entry' || m.movement_type === 'sale') {
                currentBalance += amount;
            } else if (m.movement_type === 'withdrawal') {
                currentBalance -= amount;
            }
            
            processedMovements.push({
                ...m,
                accumulated: currentBalance
            });
        });
    }

    // Actualizar monto esperado final
    expectedEl.textContent = formatCurrency(currentBalance);

    // Invertir para mostrar lo más reciente arriba
    processedMovements.reverse();

    list.innerHTML = processedMovements.map(m => {
        let icon = 'fa-circle';
        let color = '#666';
        let typeLabel = 'Movimiento';
        let amountClass = '';
        let sign = '';

        if (m.type === 'opening') {
            icon = 'fa-lock-open';
            color = '#666';
            typeLabel = 'Apertura';
            amountClass = 'text-muted';
        } else if (m.movement_type === 'sale') {
            icon = 'fa-shopping-cart';
            color = 'var(--success-color)';
            typeLabel = 'Venta';
            amountClass = 'text-success';
            sign = '+';
        } else if (m.movement_type === 'entry') {
            icon = 'fa-arrow-down';
            color = 'var(--primary-color)';
            typeLabel = 'Entrada';
            amountClass = 'text-primary';
            sign = '+';
        } else if (m.movement_type === 'withdrawal') {
            icon = 'fa-arrow-up';
            color = 'var(--danger-color)';
            typeLabel = 'Retiro';
            amountClass = 'text-danger';
            sign = '-';
        }

        return `
            <div class="movement-item" style="display:flex; gap:10px; padding:12px 10px; border-bottom:1px solid #eee; align-items:center;">
                <div style="width:35px; height:35px; border-radius:50%; background:${color}20; color:${color}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i class="fas ${icon}"></i>
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:0.95em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${typeLabel}</div>
                    <div style="font-size:0.85em; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.description || '-'}</div>
                    <div style="font-size:0.75em; color:#999;">
                        <i class="fas fa-user"></i> ${m.user_name} &bull; ${new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:bold; font-size:1.1em;" class="${amountClass}">
                        ${sign}${formatCurrency(m.amount)}
                    </div>
                    <div style="font-size:0.75em; color:#999; margin-top:2px;">
                        Acum: ${formatCurrency(m.accumulated)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openOpenRegisterModal(terminalId, terminalName) {
    document.getElementById('openTerminalId').value = terminalId;
    document.getElementById('openTerminalName').value = terminalName;
    document.getElementById('initialAmount').value = '';
    document.getElementById('openRegisterModal').classList.add('show');
}

function openCloseRegisterModal(registerId, terminalName, expectedAmount) {
    document.getElementById('closeRegisterId').value = registerId;
    document.getElementById('closeTerminalName').value = terminalName;
    document.getElementById('countedAmount').value = '';
    document.getElementById('closeNotes').value = '';
    document.getElementById('diffDisplay').textContent = '';
    
    // Fetch details for summary
    fetch(`../api/cash_register/current_register.php?register_id=${registerId}`)
        .then(r => r.json())
        .then(res => {
            if(res.success) {
                const t = res.data.totals;
                const reg = res.data.register;
                document.getElementById('closeInitial').textContent = formatCurrency(reg.initial_amount);
                document.getElementById('closeSales').textContent = formatCurrency(t.sales);
                document.getElementById('closeEntries').textContent = formatCurrency(t.entries);
                document.getElementById('closeWithdrawals').textContent = formatCurrency(t.withdrawals);
                document.getElementById('closeExpected').textContent = formatCurrency(t.expected_amount);
                document.getElementById('closeExpected').dataset.amount = t.expected_amount;
            }
        });

    document.getElementById('closeRegisterModal').classList.add('show');
}

function openMovementsModal(registerId) {
    document.getElementById('moveRegisterId').value = registerId;
    document.getElementById('moveAmount').value = '';
    document.getElementById('moveDesc').value = '';
    document.getElementById('movementsModal').classList.add('show');
}

function openAddTerminalModal() {
    document.getElementById('newTerminalName').value = '';
    document.getElementById('addTerminalModal').classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// Close drawers when clicking outside
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.drawer-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('show');
            }
        });
    });
});

// Helper to ensure notification works
function notify(msg, type) {
    if (typeof showNotification === 'function') {
        showNotification(msg, type);
    } else {
        alert(msg);
    }
}

// --- Actions ---

document.getElementById('openRegisterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        store_id: 1, 
        terminal_id: formData.get('terminal_id'),
        initial_amount: formData.get('initial_amount')
    };

    const session = await checkSession();
    if (session) data.store_id = session.store_id;

    try {
        const res = await fetch('../api/cash_register/open_register.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            notify('Caja abierta correctamente', 'success');
            closeModal('openRegisterModal');
            loadTerminals();
        } else {
            notify(result.error || 'Error al abrir caja', 'error');
        }
    } catch (err) { 
        console.error(err);
        notify('Error de conexión al abrir caja', 'error');
    }
});

document.getElementById('closeRegisterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        register_id: formData.get('register_id'),
        counted_amount: formData.get('counted_amount'),
        notes: formData.get('notes')
    };

    try {
        const res = await fetch('../api/cash_register/close_register.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            notify('Corte realizado correctamente', 'success');
            closeModal('closeRegisterModal');
            loadTerminals();
        } else {
            notify(result.error || 'Error al realizar corte', 'error');
        }
    } catch (err) { 
        console.error(err);
        notify('Error de conexión al realizar corte', 'error');
    }
});

document.getElementById('movementsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        register_id: formData.get('register_id'),
        type: formData.get('type'),
        amount: formData.get('amount'),
        description: formData.get('description')
    };

    try {
        const res = await fetch('../api/cash_register/cash_movements.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            notify('Movimiento registrado', 'success');
            closeModal('movementsModal');
            loadTerminals();
            // Si el historial está abierto, recargarlo
            if (currentHistoryRegisterId && document.getElementById('movementsHistoryDrawer').classList.contains('show')) {
                openHistoryDrawer(currentHistoryRegisterId);
            }
        } else {
            notify(result.error || 'Error al registrar movimiento', 'error');
        }
    } catch (err) { 
        console.error(err);
        notify('Error de conexión', 'error');
    }
});

document.getElementById('addTerminalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = {
        terminal_name: formData.get('terminal_name')
    };

    try {
        const res = await fetch('../api/terminals/create.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            notify('Terminal creada', 'success');
            closeModal('addTerminalModal');
            loadTerminals();
        } else {
            notify(result.error || 'Error al crear terminal', 'error');
        }
    } catch (err) { 
        console.error(err);
        notify('Error de conexión', 'error');
    }
});

async function deleteTerminal(terminalId) {
    if (!confirm('¿Estás seguro de eliminar esta terminal?')) return;
    
    try {
        const res = await fetch('../api/terminals/delete.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({terminal_id: terminalId})
        });
        const result = await res.json();
        if (result.success) {
            notify('Terminal eliminada', 'success');
            loadTerminals();
        } else {
            notify(result.error || 'Error al eliminar terminal', 'error');
        }
    } catch (err) { 
        console.error(err);
        notify('Error de conexión', 'error');
    }
}

// Calculate difference in real-time for close modal
document.getElementById('countedAmount').addEventListener('input', function(e) {
    const counted = parseFloat(e.target.value) || 0;
    const expected = parseFloat(document.getElementById('closeExpected').dataset.amount) || 0;
    const diff = counted - expected;
    const diffEl = document.getElementById('diffDisplay');
    
    if (diff === 0) {
        diffEl.innerHTML = '<span style="color: green;">Cuadra perfecto</span>';
    } else if (diff > 0) {
        diffEl.innerHTML = `<span style="color: blue;">Sobra: ${formatCurrency(diff)}</span>`;
    } else {
        diffEl.innerHTML = `<span style="color: red;">Falta: ${formatCurrency(Math.abs(diff))}</span>`;
    }
});

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
}
