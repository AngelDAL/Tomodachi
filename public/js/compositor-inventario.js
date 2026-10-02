/* ============================================================
   COMPOSITOR DE INVENTARIO (entrada y salida comparten uno solo)
   ------------------------------------------------------------
   Los dos modales —«Nueva entrada» y «Nueva salida»— son el mismo problema:
   buscar productos, elegir cuántos, revisar la lista y confirmar. Tenerlos en
   UN solo compositor evita que se separen con el tiempo, y garantiza que lo
   que se aprende en uno sirve en el otro.

   Lo que resuelve, pedido por Ángel (2-oct-2026):
     · La lupa va DENTRO del campo y los filtros se pliegan, como en Punto de
       Venta: mismo gesto, misma lectura.
     · La TARJETA ENTERA agrega y quita (Ángel, 2-oct, segunda vuelta): sin botón
       «Agregar» que apuntar; al elegir aparece la palomita y la etiqueta «En lista»,
       y volver a tocar desmarca. La cantidad se recuerda: desmarcar y volver a
       marcar no cuesta volver a escribirla.
     · La foto sale de `getRelativeImagePath` (el mismo ayudante que el POS): las
       rutas se guardan con el prefijo `public/` y sin quitarlo ninguna foto carga.
     · En el teléfono el compositor son DOS vistas con deslizamiento —catálogo y
       lista—, como pasar al carrito en Punto de Venta: la lista deja de estar a
       12.000 px de distancia, y cada panel se desplaza por su cuenta.
     · Los renglones elegidos llevan la FOTO DE FONDO (ahorra renglones) y su
       cantidad con − / + de UNO EN UNO.
     · Al tocar la cantidad se selecciona TODO: escribir 10 sobre un 1 da 10,
       no 110.
     · Deslizar un renglón a la izquierda lo quita (y el botón × sigue ahí,
       porque un gesto no puede ser la única puerta).
   ============================================================ */

const CI_TIPOS = { stock: 'Producto final', component: 'Componente', recipe: 'Preparado' };

const CompositorInv = (() => {

    /* ---------- utilidades ---------- */

    const numero = v => {
        const n = Number(v) || 0;
        return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    };
    // Enteros, siempre: la cantidad sube de uno en uno. Se recorta lo que no sean dígitos
    // en vez de dejar que el usuario escriba "1.5" y falle después en el API.
    const entero = v => Math.max(1, Math.round(Number(v) || 0));
    // Las rutas de las fotos se guardan como `public/assets/images/products/x.jpg`, y las
    // páginas viven DENTRO de `public/`: sin quitar ese prefijo el navegador resuelve
    // `public/public/...` y ninguna foto aparece (queda el cuadro gris y nada más). El POS
    // ya lo resuelve con `getRelativeImagePath`; aquí se usa el mismo ayudante.
    const IMAGEN_POR_DEFECTO = 'assets/images/products/default-product.svg';
    const imagenDe = p => {
        const cruda = p && p.image_path;
        const limpia = typeof getRelativeImagePath === 'function' ? getRelativeImagePath(cruda) : cruda;
        return limpia || IMAGEN_POR_DEFECTO;
    };
    const categoriasDe = productos => {
        const mapa = new Map();
        productos.forEach(p => {
            if (p.category_id && p.category_name) mapa.set(String(p.category_id), p.category_name);
        });
        return [...mapa.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    };

    /* ---------- estado del compositor abierto ---------- */

    let est = null;

    /* ---------- tarjeta del catálogo ---------- */

    function tarjeta(p, elegido) {
        const tipo = CI_TIPOS[p.tracking_type] || 'Producto';
        const hay = Number(p.available ?? p.current_stock ?? 0);
        const claseStock = typeof stockClasses === 'function' ? stockClasses(hay, p.min_stock ?? 0) : '';
        const hayTxt = typeof stockQty === 'function' ? stockQty(hay) : numero(hay);
        const aviso = (est.modo === 'salida' && hay <= 0) ? ' agotado' : '';
        const cuantas = elegido ? (Number(est.sel.get(Number(p.product_id))?.cantidad) || 1) : 0;
        return `<article class="ci-card${elegido ? ' elegida' : ''}${aviso}" data-id="${p.product_id}"
                role="button" tabindex="0" aria-pressed="${elegido}"
                aria-label="${elegido ? 'Quitar de la lista' : 'Agregar a la lista'}: ${esc(p.product_name)}">
            <div class="ci-card-media">
                <img src="${esc(imagenDe(p))}" alt="Foto de ${esc(p.product_name)}" loading="lazy"
                     onerror="this.onerror=null;this.src='${IMAGEN_POR_DEFECTO}'">
                ${elegido ? `<span class="ci-card-palomita" aria-hidden="true"><i class="fas fa-check"></i></span>` : ''}
            </div>
            <div class="ci-card-datos">
                <strong class="ci-card-nombre" title="${esc(p.product_name)}">${esc(p.product_name)}</strong>
                <span class="ci-card-meta">${tipo} · <span class="ci-card-hay ${claseStock}">Hay ${hayTxt}</span></span>
            </div>
            ${elegido ? `<span class="ci-card-enlista"><i class="fas fa-check"></i> En lista${cuantas > 1 ? ` · ${numero(cuantas)}` : ''}</span>` : ''}
        </article>`;
    }

    /* ---------- catálogo ---------- */

    function productosFiltrados() {
        const { texto, categoria, tipo, orden } = est.filtro;
        const t = texto.toLowerCase().trim();
        let lista = est.productos.filter(p =>
            (!t || `${p.product_name} ${p.barcode || ''} ${p.qr_code || ''}`.toLowerCase().includes(t)) &&
            (!categoria || String(p.category_id || '') === categoria) &&
            (!tipo || p.tracking_type === tipo)
        );
        if (orden === 'existencia') {
            lista = lista.slice().sort((a, b) => Number(b.available ?? b.current_stock ?? 0) - Number(a.available ?? a.current_stock ?? 0));
        } else if (orden === 'nombre') {
            lista = lista.slice().sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
        }
        return lista;
    }

    function pintarCatalogo() {
        const caja = est.dom.galeria;
        const lista = productosFiltrados();
        if (!lista.length) {
            caja.className = 'ci-galeria';
            caja.innerHTML = '<div class="empty-state"><i class="fas fa-magnifying-glass"></i><br>No hay productos con estos filtros</div>';
            return;
        }
        caja.className = 'ci-galeria' + (est.vista === 'lista' ? ' en-lista' : '');
        caja.innerHTML = lista.map(p => tarjeta(p, est.sel.has(Number(p.product_id)))).join('');
    }

    /* ---------- lista elegida ---------- */

    function fila(producto, cantidad) {
        const hay = Number(producto.available ?? producto.current_stock ?? 0);
        const extra = est.modo === 'entrada'
            ? `Último costo ${money(ultimoCosto(producto))}`
            : `Hay ${numero(hay)}${cantidad > hay + 0.0001 ? ' · pides más de lo que hay' : ''}`;
        return `<div class="ci-fila" data-id="${producto.product_id}">
            <span class="ci-fila-fondo" style="background-image:url('${esc(imagenDe(producto))}')" aria-hidden="true"></span>
            <span class="ci-fila-velo" aria-hidden="true"></span>
            <div class="ci-fila-datos">
                <strong title="${esc(producto.product_name)}">${esc(producto.product_name)}</strong>
                <small>${extra}</small>
            </div>
            <div class="ci-paso" role="group" aria-label="Cantidad de ${esc(producto.product_name)}">
                <button type="button" class="ci-paso-btn" data-paso="-1" aria-label="Uno menos"><i class="fas fa-minus"></i></button>
                <!-- Texto con teclado numérico, NO type=number: en number el navegador no deja
                     seleccionar el contenido de forma fiable (y escribir 10 sobre un 1 daba 110),
                     además de traer flechitas y cambiar de valor con la rueda del ratón. -->
                <input type="text" class="ci-paso-num" value="${numero(cantidad)}" inputmode="numeric"
                       pattern="[0-9]*" autocomplete="off" aria-label="Cantidad de ${esc(producto.product_name)}">
                <button type="button" class="ci-paso-btn" data-paso="1" aria-label="Uno más"><i class="fas fa-plus"></i></button>
            </div>
            <button type="button" class="ci-fila-quitar" data-quitar="${producto.product_id}"
                    aria-label="Quitar ${esc(producto.product_name)} de la lista" title="Quitar de la lista">
                <i class="fas fa-xmark"></i>
            </button>
        </div>`;
    }

    function ultimoCosto(p) {
        return Math.max(0, Number(p.derived_cost ?? p.cost ?? p.unit_cost ?? 0) || 0);
    }

    function piezas() {
        return [...est.sel.values()].reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
    }

    function pintarSeleccion() {
        const caja = est.dom.seleccion;
        if (!est.sel.size) {
            caja.innerHTML = `<div class="ci-vacio"><i class="fas fa-hand-pointer"></i><p>Toca un producto para agregarlo.<br>Aquí se van a ir acomodando.</p></div>`;
        } else {
            caja.innerHTML = [...est.sel.values()].map(x => fila(x.producto, x.cantidad)).join('');
        }
        actualizarPie();
        est.dom.accion.disabled = est.sel.size === 0;
        engancharFilas();
    }

    /* ---------- gestos y controles de los renglones ---------- */

    /**
     * Cambia la cantidad SIN repintar la lista.
     *
     * Antes se repintaba con `innerHTML` y eso rompía el caso más común: tocar «+» justo
     * después de escribir. El clic en el botón provoca el `blur` del campo, el `blur`
     * repintaba, y el botón que el dedo había tocado ya no existía cuando el navegador
     * emitía el `click` — se perdía el toque. Actualizar solo el renglón evita el problema
     * y además se siente más ligero.
     */
    function actualizarPie() {
        const piezas = [...est.sel.values()].reduce((s, x) => s + (Number(x.cantidad) || 0), 0);
        est.dom.cuenta.textContent = est.sel.size
            ? `${est.sel.size} producto${est.sel.size === 1 ? '' : 's'} · ${numero(piezas)} unidad${piezas === 1 ? '' : 'es'}`
            : 'Todavía no hay nada en la lista';
        // La pestaña de la lista lleva el conteo: desde el catálogo se ve cuántos van.
        if (est.dom.pestanaLista) {
            est.dom.pestanaLista.textContent = est.sel.size ? `Lista · ${est.sel.size}` : 'Lista';
        }
        if (est.dom.presupuesto) {
            const total = [...est.sel.values()].reduce((s, x) => s + ultimoCosto(x.producto) * (Number(x.cantidad) || 0), 0);
            est.dom.presupuesto.textContent = money(total);
        }
    }

    function poner(id, cantidad) {
        const x = est.sel.get(id);
        if (!x) return;
        x.cantidad = Math.max(1, Math.round(Number(cantidad)) || 1);
        const num = est.dom.seleccion.querySelector(`.ci-fila[data-id="${id}"] .ci-paso-num`);
        if (num && num.value !== String(x.cantidad)) num.value = x.cantidad;
        // La etiqueta «En lista · N» de la tarjeta se actualiza EN EL LUGAR: repintar todo el
        // catálogo por cada tecla sería caro (140 tarjetas) y volvería a comerse el toque que
        // el usuario acaba de dar.
        const etiqueta = est.dom.galeria.querySelector(`.ci-card[data-id="${id}"] .ci-card-enlista`);
        if (etiqueta) etiqueta.innerHTML = `<i class="fas fa-check"></i> En lista${x.cantidad > 1 ? ` · ${numero(x.cantidad)}` : ''}`;
        actualizarPie();
    }

    function quitar(id, motivo) {
        const x = est.sel.get(id);
        if (x) est.previas.set(id, Math.max(1, Math.round(Number(x.cantidad) || 1)));
        est.sel.delete(id);
        pintarSeleccion();
        pintarCatalogo();
        if (motivo && x) notify(`«${x.producto.product_name}» fuera de la lista`, 'info');
    }

    /**
     * Marca o desmarca un producto desde su tarjeta.
     *
     * Desmarcar NO borra la cantidad: se guarda en `previas` para que volver a marcarlo
     * regrese con lo que tenía (pedido explícito de Ángel: «si lo vuelve a agregar, pues le
     * regresa el check y la cantidad»).
     */
    function alternar(pid) {
        if (est.sel.has(pid)) { quitar(pid, false); return; }
        const p = est.productos.find(x => Number(x.product_id) === pid);
        if (!p) return;
        const cantidad = est.previas.get(pid) || 1;
        est.sel.set(pid, { producto: p, cantidad });
        pintarSeleccion();
        pintarCatalogo();
        // Que se vea QUÉ se agregó: el renglón nuevo se resalta un instante (si la lista
        // está a la vista; en el teléfono está en el otro panel y el aviso es la palomita).
        const fila = est.dom.seleccion.querySelector(`.ci-fila[data-id="${pid}"]`);
        if (fila) { fila.classList.add('recien'); setTimeout(() => fila.classList.remove('recien'), 700); }
    }

    function engancharFilas() {
        est.dom.seleccion.querySelectorAll('.ci-fila').forEach(filaEl => {
            const id = Number(filaEl.dataset.id);

            // − / +  de uno en uno, y el campo selecciona TODO al enfocarlo.
            filaEl.querySelectorAll('[data-paso]').forEach(b => {
                b.addEventListener('click', () => {
                    const x = est.sel.get(id);
                    if (!x) return;
                    poner(id, (Number(x.cantidad) || 1) + Number(b.dataset.paso));
                });
            });
            const num = filaEl.querySelector('.ci-paso-num');
            // Seleccionar TODO al enfocar (y al volver a tocar el campo) es lo que arregla el
            // "1" + "10" = "110": escribir encima reemplaza en vez de concatenar. En un campo
            // de una sola cifra nadie necesita colocar el cursor en medio: se reemplaza.
            const seleccionarTodo = () => { try { num.select(); } catch (e) {} };
            num.addEventListener('focus', seleccionarTodo);
            // pointerup/click con un respiro: el navegador recoloca el cursor al soltar, así
            // que la selección tiene que hacerse DESPUÉS de eso.
            const seleccionarTrasTocar = () => setTimeout(seleccionarTodo, 0);
            num.addEventListener('pointerup', seleccionarTrasTocar);
            num.addEventListener('click', seleccionarTrasTocar);
            num.addEventListener('input', () => {
                const limpio = String(num.value).replace(/[^0-9]/g, '');
                if (limpio !== num.value) num.value = limpio;
                const x = est.sel.get(id);
                if (x && limpio !== '') { x.cantidad = Math.max(1, parseInt(limpio, 10)); actualizarPie(); }
            });
            // Al salir del campo se normaliza EN EL LUGAR (sin repintar): un repintado aquí se
            // come el clic del botón que el usuario acaba de tocar.
            num.addEventListener('blur', () => poner(id, num.value));

            filaEl.querySelector('[data-quitar]')?.addEventListener('click', () => quitar(id, true));

            // Deslizar a la IZQUIERDA para quitarlo: se revela el fondo rojo y se decide al
            // soltar. Es el mismo gesto que quitar un platillo del pedido en la carta.
            let x0 = null, dx = 0, arrastrando = false;
            filaEl.addEventListener('pointerdown', ev => {
                if (ev.target.closest('input, button')) return;   // los controles no arrastran
                x0 = ev.clientX; dx = 0; arrastrando = true;
                filaEl.classList.add('arrastrando');
            });
            filaEl.addEventListener('pointermove', ev => {
                if (!arrastrando) return;
                dx = ev.clientX - x0;
                if (dx > 0) dx = 0;                                // solo hacia la izquierda
                filaEl.style.transform = `translateX(${dx}px)`;
                filaEl.classList.toggle('para-quitar', dx < -70);
                if (ev.cancelable) ev.preventDefault();
            });
            const soltar = () => {
                if (!arrastrando) return;
                arrastrando = false;
                filaEl.classList.remove('arrastrando');
                filaEl.style.transform = '';
                const quitarYa = dx < -70;
                filaEl.classList.remove('para-quitar');
                if (quitarYa) { quitar(id, true); }
                dx = 0; x0 = null;
            };
            filaEl.addEventListener('pointerup', soltar);
            filaEl.addEventListener('pointercancel', soltar);
            filaEl.addEventListener('pointerleave', soltar);
        });
    }

    /* ---------- campos propios de cada modo ---------- */

    function bloqueMotivo() {
        const motivos = ['', 'transfer', 'loss', 'damage', 'expiry', 'internal', 'other'];
        const etiquetas = { '': 'Sin especificar', transfer: 'Traspaso', loss: 'Pérdida', damage: 'Siniestro', expiry: 'Caducidad', internal: 'Consumo interno', other: 'Otro' };
        const iconos = { '': 'fa-circle-question', transfer: 'fa-truck-arrow-right', loss: 'fa-arrow-trend-down', damage: 'fa-triangle-exclamation', expiry: 'fa-hourglass-end', internal: 'fa-utensils', other: 'fa-ellipsis' };
        return `<div class="ci-campo">
            <span class="ci-campo-titulo">¿Por qué sale? <small>(opcional)</small></span>
            <div class="ci-motivos" id="ciMotivos">
                ${motivos.map(m => `<button type="button" class="ci-motivo" data-motivo="${m}" aria-pressed="${m === ''}">
                    <i class="fas ${iconos[m]}"></i> ${etiquetas[m]}</button>`).join('')}
            </div>
        </div>
        <div class="ci-destino" id="ciDestino" hidden>
            <label class="ci-campo">¿A qué empresa se traspasa?
                <select id="ciDestinoSelect" class="filter-select"></select>
            </label>
            <label class="ci-campo">A dónde va
                <input type="text" id="ciDestinoNota" maxlength="150" placeholder="Sucursal, proveedor, cliente…">
            </label>
        </div>
        <label class="ci-campo">Aclaración del motivo
            <input type="text" id="ciMotivoNota" maxlength="255" placeholder="Opcional: se cayó la charola, robo…">
        </label>`;
    }

    /* ---------- abrir ---------- */

    function abrir(opciones) {
        const o = Object.assign({
            modo: 'entrada',
            titulo: 'Compositor',
            icono: 'fa-box',
            productos: [],
            vista: 'cuadricula',
            textoAccion: 'Confirmar',
            textoLista: 'Lista',
            campos: {},
            seleccionInicial: null,     // Map para EDITAR algo ya guardado
        }, opciones || {});

        const esEntrada = o.modo === 'entrada';
        const id = 'ciCompositorModal';

        est = {
            modo: o.modo,
            o,
            productos: o.productos,
            sel: o.seleccionInicial ? new Map(o.seleccionInicial) : new Map(),
            vista: o.vista,
            // Cantidad que tenía cada producto al desmarcarlo: al volver a marcarlo regresa
            // con ella, en vez de obligar a escribirla otra vez.
            previas: new Map(),
            filtro: { texto: '', categoria: '', tipo: '', orden: 'nombre' },
            dom: {},
        };

        const categorias = categoriasDe(o.productos);
        const tipos = [...new Set(o.productos.map(p => p.tracking_type))];

        const camposPropios = [
            o.campos.proveedor ? `<label class="ci-campo">Proveedor
                <input type="text" id="ciProveedor" maxlength="150" placeholder="Opcional"></label>` : '',
            o.campos.motivo ? bloqueMotivo() : '',
            o.campos.notas ? `<label class="ci-campo">Notas
                <textarea id="ciNotas" rows="2" maxlength="1000" placeholder="Opcional"></textarea></label>` : '',
        ].join('');

        const cuerpo = `<div class="ci-pestanas" id="ciPestanas" role="tablist">
                <button type="button" class="ci-pestana activa" data-pane="catalogo" role="tab" aria-selected="true">
                    <i class="fas fa-th-large" aria-hidden="true"></i> Productos
                </button>
                <button type="button" class="ci-pestana" data-pane="lista" role="tab" aria-selected="false">
                    <i class="fas fa-clipboard-list" aria-hidden="true"></i> <span id="ciPestanaLista">Lista</span>
                </button>
            </div>
            <div class="ci-layout" id="ciLayout">
            <section class="ci-catalogo" id="ciCatalogo">
                <div class="ci-buscador">
                    <span class="ci-caja">
                        <i class="fas fa-search" aria-hidden="true"></i>
                        <input type="search" id="ciBuscar" placeholder="Buscar producto…" autocomplete="off" aria-label="Buscar producto">
                    </span>
                    ${o.campos.express ? `<button type="button" class="btn-secondary ci-express" id="ciExpress"><i class="fas fa-wand-magic-sparkles"></i> Alta express</button>` : ''}
                </div>
                <div class="ci-filtros-cab">
                    <button type="button" class="ci-filtros-toggle" id="ciFiltrosToggle" aria-expanded="false" aria-controls="ciFiltros">
                        <i class="fas fa-sliders"></i>
                        <span id="ciFiltrosResumen">Filtros y orden</span>
                        <i class="fas fa-chevron-down ci-flecha"></i>
                    </button>
                </div>
                <div class="ci-filtros" id="ciFiltros" hidden>
                    <label class="sr-only" for="ciCategoria">Categoría</label>
                    <select id="ciCategoria" class="filter-select">
                        <option value="">Todas las categorías</option>
                        ${categorias.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('')}
                    </select>
                    <label class="sr-only" for="ciTipo">Tipo</label>
                    <select id="ciTipo" class="filter-select">
                        <option value="">Todos los tipos</option>
                        ${tipos.map(t => `<option value="${esc(t)}">${esc(CI_TIPOS[t] || t)}</option>`).join('')}
                    </select>
                    <label class="sr-only" for="ciOrden">Ordenar por</label>
                    <select id="ciOrden" class="filter-select">
                        <option value="nombre">Nombre: A-Z</option>
                        <option value="existencia">Existencia: mayor primero</option>
                    </select>
                    <div class="ci-vista" role="group" aria-label="Cambiar vista">
                        <button type="button" class="ci-vista-btn" data-vista="cuadricula" title="Vista de cuadrícula" aria-label="Vista cuadrícula" aria-pressed="true"><i class="fas fa-th-large"></i></button>
                        <button type="button" class="ci-vista-btn" data-vista="lista" title="Vista de lista compacta" aria-label="Vista lista" aria-pressed="false"><i class="fas fa-list"></i></button>
                    </div>
                </div>
                <div class="ci-galeria" id="ciGaleria"></div>
            </section>
            <aside class="ci-lista" id="ciLista">
                <div class="ci-lista-cab">
                    <h3><i class="fas ${o.icono}"></i> ${esc(o.textoLista)}</h3>
                    <button type="button" class="ci-icono" id="ciVaciar" title="Vaciar la lista" aria-label="Vaciar la lista"><i class="fas fa-trash"></i></button>
                </div>
                ${camposPropios}
                <p class="ci-ayuda"><i class="fas fa-hand-point-left"></i> Desliza un renglón a la izquierda para quitarlo.</p>
                <div class="ci-seleccion" id="ciSeleccion"></div>
                <div class="ci-pie">
                    <span id="ciCuenta" aria-live="polite">Todavía no hay nada en la lista</span>
                    ${o.campos.presupuesto ? `<span class="ci-pie-total">Presupuesto estimado <strong id="ciPresupuesto">$0.00</strong></span>` : ''}
                </div>
            </aside>
            </div>`;

        const acciones = `<button type="button" class="btn-secondary" data-close-modal="${id}">Cancelar</button>
            <button type="button" class="btn-primary" id="ciAccion"><i class="fas ${o.icono}"></i> ${esc(o.textoAccion)}</button>`;

        const modal = modalFrame(id, `<i class="fas ${o.icono}"></i> ${esc(o.titulo)}`, cuerpo, acciones);
        const d = est.dom;
        d.modal = modal;
        d.galeria = modal.querySelector('#ciGaleria');
        d.seleccion = modal.querySelector('#ciSeleccion');
        d.cuenta = modal.querySelector('#ciCuenta');
        d.presupuesto = modal.querySelector('#ciPresupuesto');
        d.accion = modal.querySelector('#ciAccion');
        d.pestanas = modal.querySelector('#ciPestanas');
        d.pestanaLista = modal.querySelector('#ciPestanaLista');
        d.layout = modal.querySelector('#ciLayout');
        d.lista = modal.querySelector('#ciLista');
        d.destinos = [];
        // En el teléfono el cuerpo del modal NO se desplaza: se desplaza cada panel, y entre
        // paneles se desliza. Con el cuerpo desplazándose, la lista quedaba a 12.000 px del
        // catálogo (medido a 390 px con 140 productos) y el dedo no llegaba nunca.
        modal.querySelector('.modal-body')?.classList.add('ci-body');

        /* --- buscador --- */
        const buscar = modal.querySelector('#ciBuscar');
        buscar.addEventListener('input', () => { est.filtro.texto = buscar.value; pintarCatalogo(); });

        /* --- filtros plegables (mismo patrón que Punto de Venta) --- */
        const toggle = modal.querySelector('#ciFiltrosToggle');
        const filtros = modal.querySelector('#ciFiltros');
        const resumen = modal.querySelector('#ciFiltrosResumen');
        const actualizarResumen = () => {
            const partes = [];
            const cat = modal.querySelector('#ciCategoria');
            if (cat.value) partes.push(cat.options[cat.selectedIndex].textContent);
            const tipo = modal.querySelector('#ciTipo');
            if (tipo.value) partes.push(tipo.options[tipo.selectedIndex].textContent);
            if (est.filtro.orden !== 'nombre') partes.push('Existencia');
            resumen.textContent = partes.length ? partes.join(' · ') : 'Filtros y orden';
        };
        toggle.addEventListener('click', () => {
            const abierto = filtros.hasAttribute('hidden');
            filtros.toggleAttribute('hidden', !abierto);
            toggle.setAttribute('aria-expanded', abierto ? 'true' : 'false');
            toggle.classList.toggle('abierto', abierto);
        });
        // En pantalla ancha los filtros caben a la vista; en el teléfono empiezan plegados.
        if (window.matchMedia('(min-width: 900px)').matches) {
            filtros.removeAttribute('hidden');
            toggle.setAttribute('aria-expanded', 'true');
            toggle.classList.add('abierto');
        }
        modal.querySelector('#ciCategoria').addEventListener('change', ev => { est.filtro.categoria = ev.target.value; actualizarResumen(); pintarCatalogo(); });
        modal.querySelector('#ciTipo').addEventListener('change', ev => { est.filtro.tipo = ev.target.value; actualizarResumen(); pintarCatalogo(); });
        modal.querySelector('#ciOrden').addEventListener('change', ev => { est.filtro.orden = ev.target.value; actualizarResumen(); pintarCatalogo(); });
        modal.querySelectorAll('.ci-vista-btn').forEach(b => {
            b.addEventListener('click', () => {
                est.vista = b.dataset.vista;
                modal.querySelectorAll('.ci-vista-btn').forEach(x => {
                    const activo = x === b;
                    x.classList.toggle('activo', activo);
                    x.setAttribute('aria-pressed', activo ? 'true' : 'false');
                });
                pintarCatalogo();
            });
        });
        modal.querySelector('.ci-vista-btn[data-vista="' + est.vista + '"]')?.click();

        /* --- paneles del teléfono: productos y lista, con deslizamiento --- */
        const esAngosto = () => window.matchMedia('(max-width: 900px)').matches;
        const marcarPestana = (cual) => {
            d.pestanas?.querySelectorAll('.ci-pestana').forEach(x => {
                const activa = x.dataset.pane === cual;
                x.classList.toggle('activa', activa);
                x.setAttribute('aria-selected', activa ? 'true' : 'false');
            });
        };
        function irAPane(cual) {
            marcarPestana(cual);
            if (esAngosto()) {
                d.layout.scrollTo({ left: cual === 'lista' ? d.layout.clientWidth : 0, behavior: 'smooth' });
            }
        }
        d.pestanas?.addEventListener('click', ev => {
            const b = ev.target.closest('[data-pane]');
            if (b) irAPane(b.dataset.pane);
        });
        // Deslizar es el gesto principal (como pasar al carrito en Punto de Venta) y las
        // pestañas son la puerta de respaldo: un gesto no puede ser la única forma.
        d.layout?.addEventListener('scroll', () => {
            if (!esAngosto()) return;
            marcarPestana(d.layout.scrollLeft > d.layout.clientWidth / 2 ? 'lista' : 'catalogo');
        }, { passive: true });
        // Si la ventana se ensancha (tableta girada, ventana agrandada), las dos columnas
        // vuelven a estar a la vista y el deslizamiento deja de tener sentido.
        window.addEventListener('resize', () => {
            if (!esAngosto() && d.layout) { d.layout.scrollLeft = 0; marcarPestana('catalogo'); }
        });

        /* --- la tarjeta entera agrega y quita --- */
        d.galeria.addEventListener('click', ev => {
            const t = ev.target.closest('.ci-card');
            if (t) alternar(Number(t.dataset.id));
        });
        // Con teclado, la tarjeta es un botón: Enter y la barra espaciadora la marcan.
        d.galeria.addEventListener('keydown', ev => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const t = ev.target.closest('.ci-card');
            if (!t) return;
            ev.preventDefault();
            alternar(Number(t.dataset.id));
        });

        /* --- vaciar --- */
        modal.querySelector('#ciVaciar').addEventListener('click', () => {
            if (!est.sel.size) return;
            decisionModal('Vaciar la lista', 'Se quitan todos los productos elegidos.', 'Vaciar', () => {
                est.sel.clear();
                est.previas.clear();     // vaciar es un reinicio: no se recuerdan cantidades
                pintarSeleccion();
                pintarCatalogo();
            }, true);
        });

        /* --- motivo (salida) --- */
        const motivos = modal.querySelector('#ciMotivos');
        if (motivos) {
            motivos.addEventListener('click', ev => {
                const b = ev.target.closest('[data-motivo]');
                if (!b) return;
                motivos.querySelectorAll('[data-motivo]').forEach(x => {
                    const activo = x === b;
                    x.classList.toggle('activo', activo);
                    x.setAttribute('aria-pressed', activo ? 'true' : 'false');
                });
                const caja = modal.querySelector('#ciDestino');
                if (caja) caja.hidden = b.dataset.motivo !== 'transfer';
            });
        }

        /* --- alta express (solo entrada) --- */
        if (o.campos.express && typeof o.alCrearProducto === 'function') {
            modal.querySelector('#ciExpress').addEventListener('click', () => o.alCrearProducto(modal, (producto) => {
                est.productos.push(producto);
                est.sel.set(Number(producto.product_id), { producto, cantidad: 1 });
                pintarSeleccion();
                pintarCatalogo();
            }));
        }

        /* --- confirmar --- */
        d.accion.addEventListener('click', async () => {
            const items = [...est.sel.values()].map(x => ({
                product_id: Number(x.producto.product_id),
                cantidad: Math.max(1, Math.round(Number(x.cantidad) || 1)),
                producto: x.producto,
                item_id: x.producto.item_id ? Number(x.producto.item_id) : null,
                planned_quantity: Math.max(1, Math.round(Number(x.cantidad) || 1)),
            }));
            if (!items.length) { notify('Elige al menos un producto', 'error'); return; }
            const campos = {
                proveedor: modal.querySelector('#ciProveedor')?.value.trim() || null,
                notas: modal.querySelector('#ciNotas')?.value.trim() || null,
                motivo: motivos ? (motivos.querySelector('.ci-motivo.activo')?.dataset.motivo || '') : '',
                motivoNota: modal.querySelector('#ciMotivoNota')?.value.trim() || null,
                destinoId: modal.querySelector('#ciDestinoSelect')?.value || '',
                destinoNota: modal.querySelector('#ciDestinoNota')?.value.trim() || null,
                presupuesto: d.presupuesto ? d.presupuesto.textContent : null,
            };
            d.accion.disabled = true;
            try {
                await o.alGuardar(items, campos);
                modal.remove();
            } catch (e) {
                notify(e.message, 'error');
                d.accion.disabled = false;
            }
        });

        /* --- teclado: Escape cierra --- */
        modal.addEventListener('keydown', ev => { if (ev.key === 'Escape') modal.remove(); });

        pintarSeleccion();
        pintarCatalogo();
        setTimeout(() => buscar.focus(), 80);
        return modal;
    }

    return { abrir, numero, entero, categoriasDe, ultimoCosto };
})();
