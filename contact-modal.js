// De Club — Contact modal (shared across all pages)
//
// Handles modal open/close wiring, HMAC-SHA256 signing of the form payload,
// and the POST to the Netlify Function that forwards to Trigger.dev's
// `lead-intake` task. The function verifies the signature before forwarding.
// Keeps casual spam out; a motivated reader of this source can extract
// WEBHOOK_HMAC_SECRET and forge payloads, but blocking that tier requires
// a backend signer (separate scope).

(function () {
  'use strict';

  // Shared secret: browser (this file) and Netlify Function env var
  // WEBHOOK_HMAC_SECRET. Rotation: generate a new 32-byte hex, update here
  // + Netlify env + General/.env, then deploy.
  var WEBHOOK_SECRET = '458094bae8debf2fa2a6eed653fa8d55e67b943e11ec1581556e21b02ba386ec';
  var WEBHOOK_URL = '/.netlify/functions/submit-lead';

  var modal = document.getElementById('contactModal');
  if (!modal) return;

  var closeBtn = document.getElementById('modalClose');
  var form = document.getElementById('contactForm');
  var formWrap = document.getElementById('modalFormWrap');
  var success = document.getElementById('modalSuccess');

  function openModal(e) {
    if (e && e.preventDefault) e.preventDefault();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(function () {
      if (formWrap) formWrap.style.display = '';
      if (success) success.classList.remove('show');
      if (form) form.reset();
    }, 350);
  }

  // Wire every CTA that should open the modal. Exclude footer nav + WA links.
  document.querySelectorAll(
    'a[href*="join.html"], a.nav-link--cta, .btn--primary, .btn--ghost'
  ).forEach(function (link) {
    if (link.closest('.footer-nav')) return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('wa.me') !== -1) return;
    if (href.indexOf('whatsapp') !== -1) return;
    link.addEventListener('click', openModal);
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  // --- HMAC-SHA256 over the exact JSON string we POST, hex digest ---
  async function signHmacSha256(message, secret) {
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    var sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    var bytes = new Uint8Array(sig);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var data = new FormData(form);
      var payload = {
        name: data.get('name'),
        phone: data.get('phone'),
        email: data.get('email'),
        source: window.location.pathname,
        url: window.location.href,
        utm_source: qs('utm_source'),
        utm_medium: qs('utm_medium'),
        utm_campaign: qs('utm_campaign'),
        utm_content: qs('utm_content'),
        utm_term: qs('utm_term'),
        referrer: document.referrer,
      };
      // Canonical JSON — keys sorted alphabetically — so the HMAC we compute
      // here matches what n8n reproduces after its JSON-parse step.
      var body = JSON.stringify(payload, Object.keys(payload).sort());

      try {
        var signature = await signHmacSha256(body, WEBHOOK_SECRET);
        // Fire-and-forget — user sees success instantly regardless.
        fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
          },
          body: body,
        }).catch(function () {});
      } catch (err) {
        // Fallback: post without signature if Web Crypto unavailable.
        // The function will drop it; user still sees success UI, we just miss the lead.
        fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        }).catch(function () {});
      }

      if (formWrap) formWrap.style.display = 'none';
      if (success) success.classList.add('show');
      setTimeout(closeModal, 3000);
    });
  }
})();
