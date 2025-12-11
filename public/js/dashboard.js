let currentWeekOffset = 0;

document.addEventListener('DOMContentLoaded', async () => {
    loadDashboardStats();
    loadChartData();
    
    const prevBtn = document.getElementById('prevWeekBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentWeekOffset++;
            loadChartData();
        });
    }
    
    const nextBtn = document.getElementById('nextWeekBtn');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentWeekOffset--;
            loadChartData();
        });
    }
});

async function loadDashboardStats() {
    try {
        const response = await fetch('../api/reports/dashboard_stats.php');
        const result = await response.json();
        if (result.success) {
            const data = result.data;
            
            // Update cards
            if (document.getElementById('dailySales')) document.getElementById('dailySales').textContent = formatCurrency(data.dailySales);
            if (document.getElementById('dailyProfit')) document.getElementById('dailyProfit').textContent = formatCurrency(data.dailyProfit);
            if (document.getElementById('transactions')) document.getElementById('transactions').textContent = data.transactions;

            // New cards
            if (document.getElementById('inventoryValue')) document.getElementById('inventoryValue').textContent = formatCurrency(data.inventoryValue || 0);
            if (document.getElementById('lowStockCount')) document.getElementById('lowStockCount').textContent = data.lowStockCount || 0;
            if (document.getElementById('topCategory')) document.getElementById('topCategory').textContent = data.topCategory || '-';

            // Render Lists
            renderLowStockList(data.lowStockList);
            renderTopProductsList(data.topProducts);
            renderRecentSalesList(data.recentSales);
        }
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
    }
}

async function loadChartData() {
    try {
        // Calculate dates based on offset
        // Offset 0 = Current week (last 7 days)
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - (currentWeekOffset * 7));
        
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        
        const formatDate = (d) => d.toISOString().split('T')[0];
        const formatDisplay = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
        
        const rangeLabel = document.getElementById('chartRangeLabel');
        if (rangeLabel) {
            rangeLabel.textContent = `${formatDisplay(startDate)} - ${formatDisplay(endDate)}`;
        }
            
        // Disable "Next" if we are in the future
        const nextBtn = document.getElementById('nextWeekBtn');
        if (nextBtn) {
            nextBtn.disabled = currentWeekOffset <= 0;
        }

        const url = `../api/reports/get_chart_data.php?start_date=${formatDate(startDate)}&end_date=${formatDate(endDate)}`;
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success) {
            renderSalesChart(result.data);
        }
    } catch (error) {
        console.error('Error loading chart data:', error);
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(amount);
}

function renderTopProductsList(list) {
    const tbody = document.getElementById('topProductsList');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 1rem;">No hay datos disponibles</td></tr>';
        return;
    }
    
    list.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #eee';
        
        let imgHtml = '';
        if (item.image_path) {
            imgHtml = `<img src="/${item.image_path}" alt="${item.product_name}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;">`;
        } else {
            imgHtml = `<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: #f0f0f0; border-radius: 4px; color: #999;"><i class="fas fa-box"></i></div>`;
        }

        tr.innerHTML = `
            <td style="padding: 0.75rem;" data-label="Imagen">${imgHtml}</td>
            <td style="padding: 0.75rem;" data-label="Producto">${item.product_name}</td>
            <td style="padding: 0.75rem; font-weight: bold;" data-label="Vendidos">${item.total_sold}</td>
            <td style="padding: 0.75rem; color: #27ae60;" data-label="Ingresos">${formatCurrency(item.revenue)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLowStockList(list) {
    const tbody = document.getElementById('lowStockList');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 1rem;">No hay productos con stock bajo</td></tr>';
        return;
    }

    list.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #eee';
        tr.innerHTML = `
            <td style="padding: 0.75rem;" data-label="Producto">${item.product_name}</td>
            <td style="padding: 0.75rem; color: #e74c3c; font-weight: bold;" data-label="Stock">${item.current_stock}</td>
            <td style="padding: 0.75rem; color: #7f8c8d;" data-label="Mínimo">${item.min_stock}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderRecentSalesList(list) {
    const tbody = document.getElementById('recentSalesList');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 1rem;">No hay ventas recientes</td></tr>';
        return;
    }
    
    list.forEach(item => {
        const dateObj = new Date(item.sale_date);
        const dateStr = dateObj.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
        const timeStr = dateObj.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
        const fullDate = `${dateStr} ${timeStr}`;
        
        // Products icons
        let productsHtml = '<div style="display: flex; gap: 5px; flex-wrap: wrap;">';
        const productNames = item.products.map(p => p.name).join(', ');
        
        item.products.slice(0, 5).forEach(prod => { // Limit to 5 icons to prevent overflow
            if (prod.image) {
                productsHtml += `<img src="/${prod.image}" alt="${prod.name}" title="${prod.name}" style="width: 30px; height: 30px; object-fit: cover; border-radius: 4px; border: 1px solid #eee;">`;
            } else {
                productsHtml += `<div title="${prod.name}" style="width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: #f0f0f0; border-radius: 4px; color: #999;"><i class="fas fa-box"></i></div>`;
            }
        });
        
        if (item.products.length > 5) {
            productsHtml += `<div title="${item.products.length - 5} más..." style="width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; background: #e0e0e0; border-radius: 4px; color: #666; font-size: 0.8rem;">+${item.products.length - 5}</div>`;
        }
        productsHtml += '</div>';

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #eee';
        tr.innerHTML = `
            <td style="padding: 0.75rem; white-space: nowrap;" data-label="Fecha">${fullDate}</td>
            <td style="padding: 0.75rem;" data-label="Productos">
                <div title="${productNames}" style="cursor: help;">
                    ${productsHtml}
                </div>
            </td>
            <td style="padding: 0.75rem; font-weight: bold;" data-label="Total">${formatCurrency(item.total)}</td>
            <td style="padding: 0.75rem; color: #27ae60; font-weight: bold;" data-label="Ganancia">${formatCurrency(item.profit)}</td>
        `;
        tbody.appendChild(tr);
    });
}

let salesChart = null;

function renderSalesChart(chartData) {
    const ctx = document.getElementById('salesChart');
    if (!ctx) return;

    if (salesChart) {
        salesChart.destroy();
    }

    // Get colors from CSS variables
    const styles = getComputedStyle(document.documentElement);
    const primaryColor = styles.getPropertyValue('--primary-color').trim();
    const secondaryColor = styles.getPropertyValue('--secondary-color').trim();

    // Helper to convert hex to rgba
    const hexToRgba = (hex, alpha) => {
        let r = 0, g = 0, b = 0;
        if (hex.length === 4) {
            r = parseInt(hex[1] + hex[1], 16);
            g = parseInt(hex[2] + hex[2], 16);
            b = parseInt(hex[3] + hex[3], 16);
        } else if (hex.length === 7) {
            r = parseInt(hex.slice(1, 3), 16);
            g = parseInt(hex.slice(3, 5), 16);
            b = parseInt(hex.slice(5, 7), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Ventas',
                    data: chartData.revenue,
                    borderColor: primaryColor,
                    backgroundColor: hexToRgba(primaryColor, 0.1),
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: primaryColor,
                    pointRadius: 4
                },
                {
                    label: 'Ganancia',
                    data: chartData.profit,
                    borderColor: secondaryColor,
                    backgroundColor: hexToRgba(secondaryColor, 0.1),
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: secondaryColor,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: true, position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += formatCurrency(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [2, 4], color: '#f0f0f0' },
                    ticks: {
                        callback: function (value) {
                            return new Intl.NumberFormat('es-MX', {
                                style: 'currency',
                                currency: 'MXN',
                                maximumSignificantDigits: 3
                            }).format(value);
                        }
                    }
                },
                x: { grid: { display: false } }
            }
        }
    });
}
