/**
 * Stripe POS — cobro con tarjeta en línea para Tomodachi POS.
 *
 * Se carga en sales.html antes que sales.js. Expone window.StripePOS:
 *   - ready: el módulo está habilitado y configurado para la tienda.
 *   - charge(total, concept): abre el modal de cobro y resuelve con el
 *     payment_intent_id cuando el pago queda confirmado. Rechaza con
 *     err.stripeCancelled = true si el cajero cancela.
 *
 * Los datos de la tarjeta los captura Stripe.js (Payment Element); nunca
 * pasan por este servidor.
 */
(function () {
  'use strict';

  var stripeInstance = null;
  var publishableKey = null;
  var currency = 'mxn';

  var modal, totalEl, elementContainer, messageEl, loadingEl, payBtn, cancelBtn, closeBtn;
  var elements = null;
  var activeIntentId = null;
  var resolveCharge = null;
  var rejectCharge = null;

  function notify(message, type) {
    if (typeof showNotification === 'function') {
      showNotification(message, type);
    }
  }

  function formatMoney(amount) {
    if (typeof formatCurrency === 'function') {
      return formatCurrency(amount);
    }
    return '$' + (Math.round(amount * 100) / 100).toFixed(2);
  }

  function setLoading(isLoading) {
    if (loadingEl) loadingEl.style.display = isLoading ? 'block' : 'none';
    if (payBtn) payBtn.disabled = isLoading;
    if (cancelBtn) cancelBtn.disabled = isLoading;
  }

  function showError(message) {
    if (messageEl) {
      messageEl.textContent = message || '';
      messageEl.style.display = message ? 'block' : 'none';
    }
  }

  function resetModal() {
    showError('');
    setLoading(false);
    if (elementContainer) elementContainer.innerHTML = '';
    elements = null;
    activeIntentId = null;
  }

  function settleResolve(value) {
    var fn = resolveCharge;
    resolveCharge = null;
    rejectCharge = null;
    closeModal();
    if (fn) fn(value);
  }

  function settleReject(err) {
    var fn = rejectCharge;
    resolveCharge = null;
    rejectCharge = null;
    closeModal();
    if (fn) fn(err);
  }

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    resetModal();
  }

  async function createIntent(total, concept) {
    var res = await fetch('../api/stripe/create_payment_intent.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amount: total, concept: concept || 'Venta POS' })
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data || !data.success) {
      throw new Error((data && data.message) || 'No se pudo crear el cobro');
    }
    return data.data;
  }

  async function syncPayment(paymentIntentId) {
    try {
      await fetch('../api/stripe/confirm_payment.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ payment_intent_id: paymentIntentId })
      });
    } catch (e) {
      // El webhook o la verificación de create_sale sincronizan después
    }
  }

  async function handlePay() {
    if (!elements || !stripeInstance) return;
    showError('');
    setLoading(true);

    try {
      var result = await stripeInstance.confirmPayment({
        elements: elements,
        redirect: 'if_required'
      });

      if (result.error) {
        showError(result.error.message || 'El pago fue rechazado');
        setLoading(false);
        return;
      }

      var intent = result.paymentIntent;
      if (intent && intent.status === 'succeeded') {
        await syncPayment(intent.id);
        notify('Pago con tarjeta confirmado', 'success');
        settleResolve(intent.id);
        return;
      }

      if (intent && intent.status === 'processing') {
        await syncPayment(intent.id);
        showError('El pago está en proceso. Espera la confirmación e inténtalo de nuevo.');
        setLoading(false);
        return;
      }

      showError('El pago no se completó. Intenta de nuevo.');
      setLoading(false);
    } catch (e) {
      showError('Error al procesar el pago');
      setLoading(false);
    }
  }

  function charge(total, concept) {
    return new Promise(async function (resolve, reject) {
      if (!stripeInstance || !modal) {
        reject(new Error('Stripe no está disponible'));
        return;
      }

      resolveCharge = resolve;
      rejectCharge = reject;
      resetModal();

      if (totalEl) totalEl.textContent = formatMoney(total);
      modal.classList.remove('hidden');
      setLoading(true);

      try {
        var intent = await createIntent(total, concept);
        activeIntentId = intent.payment_intent_id;

        elements = stripeInstance.elements({ clientSecret: intent.client_secret });
        var paymentElement = elements.create('payment', {
          layout: 'tabs'
        });
        paymentElement.mount('#stripePaymentElement');
        paymentElement.on('ready', function () {
          setLoading(false);
        });
      } catch (e) {
        var err = new Error(e.message || 'No se pudo iniciar el cobro');
        settleReject(err);
      }
    });
  }

  function onCancel() {
    if (payBtn && payBtn.disabled) return; // cobro en curso
    var err = new Error('Cobro cancelado');
    err.stripeCancelled = true;
    settleReject(err);
  }

  async function init() {
    modal = document.getElementById('stripeModal');
    totalEl = document.getElementById('stripeModalTotal');
    elementContainer = document.getElementById('stripePaymentElement');
    messageEl = document.getElementById('stripePaymentMessage');
    loadingEl = document.getElementById('stripePaymentLoading');
    payBtn = document.getElementById('stripePayBtn');
    cancelBtn = document.getElementById('stripeCancelBtn');
    closeBtn = document.getElementById('closeStripeModalBtn');

    if (payBtn) payBtn.addEventListener('click', handlePay);
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
    if (closeBtn) closeBtn.addEventListener('click', onCancel);

    var option = document.getElementById('paymentMethodStripe');

    try {
      var res = await fetch('../api/stripe/public_config.php', { credentials: 'include' });
      var data = await res.json().catch(function () { return null; });
      var cfg = data && data.success ? data.data : null;

      if (cfg && cfg.enabled && cfg.publishable_key && typeof window.Stripe === 'function') {
        publishableKey = cfg.publishable_key;
        currency = cfg.currency || 'mxn';
        stripeInstance = window.Stripe(publishableKey);
        window.StripePOS.ready = true;
        if (option) option.disabled = false;
      }
    } catch (e) {
      // Stripe no disponible: la opción queda deshabilitada
    }
  }

  window.StripePOS = {
    ready: false,
    charge: charge,
    get currency() { return currency; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
