/**
 * EJEMPLOS DE USO - ScaleManager
 * 
 * Este archivo contiene ejemplos de cómo integrar ScaleManager
 * en diferentes partes de tu aplicación Tomodachi
 */

// =================================================
// EJEMPLO 1: Uso Básico
// =================================================

// Crear una instancia de ScaleManager
const scale = new ScaleManager();

// Establecer protocolo (antes de conectar)
scale.setProtocol('generic'); // 'generic', 'datalogic', 'excell'

// Conectar (muestra selector de puerto)
async function connectScale() {
  try {
    const success = await scale.requestPort();
    if (success) {
      console.log('Balanza conectada');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Registrar listener para pesos
scale.on('onWeight', (data) => {
  console.log(`Peso: ${data.weight} ${data.unit}`);
  // data.weight: número con decimales
  // data.unit: 'kg', 'g', 'lb', 'oz', etc
  // data.raw: string original del puerto
  // data.timestamp: fecha/hora de lectura
});

// Registrar listener para errores
scale.on('onError', (data) => {
  console.error(`Error de balanza: ${data.message}`);
});

// Registrar listener para conexión
scale.on('onConnect', (data) => {
  console.log('Balanza conectada exitosamente');
});

// Registrar listener para desconexión
scale.on('onDisconnect', (data) => {
  console.log('Balanza desconectada');
});

// Desconectar
async function disconnectScale() {
  await scale.disconnect();
}


// =================================================
// EJEMPLO 2: Captura de Peso en Campo de Entrada
// =================================================

const scale2 = new ScaleManager();

// Cuando se abre un modal de entrada
function openWeightInput() {
  const input = document.getElementById('weightInput');
  
  scale2.setProtocol('generic');
  scale2.requestPort();
  
  // Auto-llenar campo cuando hay peso
  scale2.on('onWeight', (data) => {
    input.value = data.weight.toFixed(3);
    input.dispatchEvent(new Event('input')); // Trigger cambio
  });
}

// Cuando se cierra el modal
function closeWeightInput() {
  scale2.disconnect();
}


// =================================================
// EJEMPLO 3: Selector de Protocolo Dinámico
// =================================================

async function connectWithProtocol(protocolName) {
  const scale3 = new ScaleManager();
  
  // Validar protocolo
  if (!['generic', 'datalogic', 'excell'].includes(protocolName)) {
    throw new Error('Protocolo desconocido');
  }
  
  scale3.setProtocol(protocolName);
  const success = await scale3.requestPort();
  
  if (success) {
    // Guardar en variable global para usar después
    window.activeScale = scale3;
    return scale3;
  }
}

// Usar después
window.activeScale.on('onWeight', (data) => {
  updateWeightDisplay(data.weight);
});


// =================================================
// EJEMPLO 4: Lectura de Peso Persistente
// =================================================

class WeightMonitor {
  constructor(elementId) {
    this.element = document.getElementById(elementId);
    this.scale = new ScaleManager();
    this.lastWeight = null;
  }
  
  async start(protocol = 'generic') {
    this.scale.setProtocol(protocol);
    await this.scale.requestPort();
    
    this.scale.on('onWeight', (data) => {
      this.lastWeight = data.weight;
      this.updateDisplay(data);
    });
    
    this.scale.on('onError', (error) => {
      this.element.innerHTML = `<span style="color:red;">Error: ${error.message}</span>`;
    });
    
    this.scale.on('onDisconnect', () => {
      this.element.innerHTML = '<span style="color:gray;">Desconectado</span>';
    });
  }
  
  updateDisplay(data) {
    this.element.innerHTML = `
      <strong>${data.weight.toFixed(3)} ${data.unit}</strong>
      <small>${new Date().toLocaleTimeString()}</small>
    `;
  }
  
  async stop() {
    await this.scale.disconnect();
  }
  
  getLastWeight() {
    return this.lastWeight;
  }
}

// Uso:
const monitor = new WeightMonitor('weightDisplay');
await monitor.start('datalogic');

// Obtener peso en cualquier momento
console.log('Peso actual:', monitor.getLastWeight());


// =================================================
// EJEMPLO 5: Formulario con Captura de Peso
// =================================================

class BulkProductForm {
  constructor(formSelector) {
    this.form = document.querySelector(formSelector);
    this.weightInput = this.form.querySelector('[name="weight"]');
    this.totalInput = this.form.querySelector('[name="total"]');
    this.pricePerUnit = this.form.getAttribute('data-price');
    this.scale = new ScaleManager();
    
    this.setupListeners();
  }
  
  setupListeners() {
    // Botón para leer de balanza
    const readBtn = this.form.querySelector('.btn-read-weight');
    if (readBtn) {
      readBtn.addEventListener('click', () => this.readFromScale());
    }
    
    // Cambios en campo de peso
    this.weightInput.addEventListener('input', () => this.updateTotal());
  }
  
  async readFromScale() {
    try {
      const connected = await this.scale.requestPort();
      if (!connected) return;
      
      this.scale.on('onWeight', (data) => {
        this.weightInput.value = data.weight.toFixed(3);
        this.updateTotal();
        this.scale.disconnect();
      });
      
      setTimeout(() => {
        if (this.scale.isConnected) {
          this.scale.disconnect();
        }
      }, 5000); // Timeout después de 5 segundos
    } catch (error) {
      alert('Error: ' + error.message);
    }
  }
  
  updateTotal() {
    const weight = parseFloat(this.weightInput.value) || 0;
    const total = weight * parseFloat(this.pricePerUnit);
    this.totalInput.value = total.toFixed(2);
  }
}

// Uso en HTML:
// <form class="bulk-form" data-price="150.00">
//   <input name="weight" placeholder="Peso (kg)" />
//   <button type="button" class="btn-read-weight">Leer de Balanza</button>
//   <input name="total" readonly />
// </form>

// En JavaScript:
// const form = new BulkProductForm('.bulk-form');


// =================================================
// EJEMPLO 6: Cambiar Protocolo en Tiempo Real
// =================================================

let currentScale = null;

async function changeScaleProtocol(newProtocol) {
  // Desconectar escala actual
  if (currentScale && currentScale.isConnected) {
    await currentScale.disconnect();
  }
  
  // Crear nueva instancia
  currentScale = new ScaleManager();
  currentScale.setProtocol(newProtocol);
  
  // Conectar con nuevo protocolo
  return await currentScale.requestPort();
}

// Selector en HTML:
// <select onchange="changeScaleProtocol(this.value)">
//   <option value="generic">Genérico</option>
//   <option value="datalogic">Datalogic</option>
//   <option value="excell">Excell</option>
// </select>


// =================================================
// EJEMPLO 7: Múltiples Listeners
// =================================================

const scale7 = new ScaleManager();

// Listener 1: Log a consola
scale7.on('onWeight', (data) => {
  console.log(`Tiempo: ${data.timestamp.toLocaleTimeString()}, Peso: ${data.weight}`);
});

// Listener 2: Actualizar UI
scale7.on('onWeight', (data) => {
  document.getElementById('weightDisplay').textContent = 
    `${data.weight.toFixed(3)} ${data.unit}`;
});

// Listener 3: Validar peso
scale7.on('onWeight', (data) => {
  if (data.weight > 50) {
    console.warn('¡Peso excesivo!');
  }
});


// =================================================
// EJEMPLO 8: Manejo de Errores Robusto
// =================================================

class RobustScale {
  constructor() {
    this.scale = new ScaleManager();
    this.reconnectAttempts = 0;
    this.maxReconnect = 3;
  }
  
  async connect(protocol) {
    try {
      if (!navigator.serial) {
        throw new Error('WebSerial API no soportado');
      }
      
      this.scale.setProtocol(protocol);
      const success = await this.scale.requestPort();
      
      if (success) {
        this.reconnectAttempts = 0;
        this.setupEventHandlers();
      }
    } catch (error) {
      this.handleError(error);
    }
  }
  
  setupEventHandlers() {
    this.scale.on('onDisconnect', () => {
      console.log('Desconectado. Reintentando...');
      this.attemptReconnect();
    });
    
    this.scale.on('onError', (error) => {
      console.error('Error de escala:', error);
    });
  }
  
  async attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnect) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Backoff exponencial
      
      setTimeout(async () => {
        console.log(`Reintentando conexión (${this.reconnectAttempts}/${this.maxReconnect})`);
        const previousPorts = await this.scale.getPreviousPorts();
        if (previousPorts.length > 0) {
          this.scale.port = previousPorts[0];
          await this.scale.connect();
        }
      }, delay);
    }
  }
  
  handleError(error) {
    console.error('Error de conexión:', error.message);
    // Notificar usuario
    showNotification(`Error de balanza: ${error.message}`, 'error');
  }
}

// Uso:
const robustScale = new RobustScale();
robustScale.connect('generic');


// =================================================
// EJEMPLO 9: Guardar Peso en Base de Datos
// =================================================

async function recordWeightWithScale(productId) {
  const scale = new ScaleManager();
  
  return new Promise(async (resolve) => {
    scale.setProtocol('generic');
    await scale.requestPort();
    
    scale.on('onWeight', async (data) => {
      // Guardar en BD
      const response = await fetch('api/sales/record_weight.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          weight: data.weight,
          unit: data.unit,
          timestamp: data.timestamp.toISOString()
        })
      });
      
      const result = await response.json();
      scale.disconnect();
      resolve(result);
    });
    
    // Timeout después de 30 segundos
    setTimeout(() => {
      scale.disconnect();
      resolve({ success: false, message: 'Timeout' });
    }, 30000);
  });
}

// Uso:
const result = await recordWeightWithScale(123);
console.log(result);


// =================================================
// EJEMPLO 10: Pruebas Automatizadas
// =================================================

async function testScaleProtocol(protocol) {
  const scale = new ScaleManager();
  scale.setProtocol(protocol);
  
  let result = {
    protocol: protocol,
    connected: false,
    weightsReceived: 0,
    averageWeight: 0,
    errors: []
  };
  
  return new Promise(async (resolve) => {
    const weights = [];
    
    scale.on('onConnect', () => {
      result.connected = true;
      console.log(`✓ ${protocol}: Conectado`);
    });
    
    scale.on('onWeight', (data) => {
      weights.push(data.weight);
      result.weightsReceived++;
      console.log(`✓ ${protocol}: Peso ${data.weight}`);
    });
    
    scale.on('onError', (error) => {
      result.errors.push(error.message);
      console.error(`✗ ${protocol}: ${error.message}`);
    });
    
    try {
      await scale.requestPort();
      
      // Esperar 10 segundos de datos
      setTimeout(() => {
        scale.disconnect();
        
        if (weights.length > 0) {
          result.averageWeight = weights.reduce((a, b) => a + b) / weights.length;
        }
        
        resolve(result);
      }, 10000);
    } catch (error) {
      result.errors.push(error.message);
      resolve(result);
    }
  });
}

// Ejecutar pruebas
async function runAllTests() {
  const protocols = ['generic', 'datalogic', 'excell'];
  const results = [];
  
  for (const protocol of protocols) {
    console.log(`Probando ${protocol}...`);
    const result = await testScaleProtocol(protocol);
    results.push(result);
  }
  
  console.table(results);
}

// runAllTests();
