document.addEventListener('DOMContentLoaded', async () => {
    const session = await checkSession();
    if (!session) { requireSession(); return; }

    if (session.role !== 'super_admin') {
        window.location.href = 'dashboard.html';
        return;
    }

    // Mostrar info del admin
    document.getElementById('adminInfo').innerHTML = `
        <div style="text-align: right;">
            <strong>${session.full_name}</strong><br>
            <span class="store-badge">Super Admin</span>
        </div>
    `;

    initBackupModule();
    loadAllUsers();

    // Search filter
    document.getElementById('userSearch').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#usersList tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    });
});

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function initBackupModule() {
    const backupForm = document.getElementById('backupForm');
    const backupEmailInput = document.getElementById('backupEmail');
    const backupStatus = document.getElementById('backupStatus');
    const generateBackupBtn = document.getElementById('generateBackupBtn');

    if (!backupForm || !backupEmailInput || !backupStatus || !generateBackupBtn) {
        return;
    }

    try {
        const profileRes = await fetch('../api/users/profile.php');
        const profileData = await profileRes.json();
        if (profileData.success && profileData.data?.email) {
            backupEmailInput.value = profileData.data.email;
        }
    } catch (error) {
        console.error('No se pudo precargar el correo de respaldo:', error);
    }

    backupForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const email = backupEmailInput.value.trim();
        if (!email) {
            showNotification('Ingresa un correo para enviar el respaldo', 'warning');
            return;
        }

        generateBackupBtn.disabled = true;
        generateBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generando...';

        try {
            const response = await fetch('../api/super_admin/create_backup.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const result = await response.json();

            if (result.success) {
                showNotification(result.message, result.data.email_sent ? 'success' : 'warning');
                backupStatus.innerHTML = `
                    <strong>Último respaldo:</strong> ${escapeHtml(result.data.backup_file)}<br>
                    <strong>Guardado en:</strong> ${escapeHtml(result.data.backup_path)}<br>
                    <strong>Correo destino:</strong> ${escapeHtml(result.data.email_to)}
                `;
            } else {
                showNotification(result.message || 'No se pudo generar el respaldo', 'error');
            }
        } catch (error) {
            console.error(error);
            showNotification('Error de conexión al generar respaldo', 'error');
        } finally {
            generateBackupBtn.disabled = false;
            generateBackupBtn.innerHTML = '<i class="fas fa-download"></i> Generar Respaldo';
        }
    });
}

async function loadAllUsers() {
    try {
        // read.php sin params devuelve todos si eres super_admin
        const res = await fetch('../api/users/read.php');
        const data = await res.json();

        if (data.success) {
            const tbody = document.getElementById('usersList');
            tbody.innerHTML = '';
            
            data.data.forEach(user => {
                const tr = document.createElement('tr');
                const isSelf = user.username === 'admin'; // O check session ID
                
                tr.innerHTML = `
                    <td>${user.user_id}</td>
                    <td>${user.username}</td>
                    <td>${user.full_name}</td>
                    <td>${user.store_name || 'N/A'} <small>(${user.store_id})</small></td>
                    <td><span class="badge badge-${user.role}">${user.role}</span></td>
                    <td>
                        <span class="badge badge-${user.status === 'active' ? 'success' : 'danger'}">
                            ${user.status === 'active' ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            ${user.role !== 'super_admin' ? `
                                <button class="btn-icon" onclick="toggleStatus(${user.user_id}, '${user.status}')" 
                                    title="${user.status === 'active' ? 'Desactivar' : 'Activar'}">
                                    <i class="fas fa-${user.status === 'active' ? 'ban' : 'check-circle'}"></i>
                                </button>
                            ` : ''}
                            <button class="btn-icon" onclick="openResetModal(${user.user_id})" title="Cambiar Contraseña">
                                <i class="fas fa-key"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        console.error(error);
        showNotification('Error cargando usuarios', 'error');
    }
}

async function toggleStatus(userId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    if (!confirm(`¿Estás seguro de cambiar el estado a ${newStatus}?`)) return;

    try {
        const res = await fetch('../api/users/update.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, status: newStatus })
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Estado actualizado', 'success');
            loadAllUsers();
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
}

function openResetModal(userId) {
    document.getElementById('resetUserId').value = userId;
    document.getElementById('resetPasswordForm').reset();
    document.getElementById('resetPasswordModal').style.display = 'block';
}

function closeResetModal() {
    document.getElementById('resetPasswordModal').style.display = 'none';
}

document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('resetUserId').value;
    const password = e.target.new_password.value;

    try {
        const res = await fetch('../api/users/update.php', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, password: password })
        });
        const result = await res.json();
        if (result.success) {
            showNotification('Contraseña actualizada', 'success');
            closeResetModal();
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('Error de conexión', 'error');
    }
});

// Close modal on outside click
window.onclick = function(event) {
    const modal = document.getElementById('resetPasswordModal');
    if (event.target == modal) {
        closeResetModal();
    }
}
