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
  // B2B corporate inquiries (corporate.html) go to their own function →
  // Trigger.dev corporate-lead → B2B Deals Monday board. Consumer leads
  // keep flowing through submit-lead → lead-intake.
  var WEBHOOK_URL_CORPORATE = '/.netlify/functions/submit-corporate-lead';

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
      clearConsentError();
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

  // International phone input (corporate.html only — the intl-tel-input
  // library is loaded there). On other pages window.intlTelInput is
  // undefined and the field stays a plain tel input, unchanged.
  var iti = null;
  var phoneInput = form ? form.querySelector('input[name="phone"]') : null;
  if (phoneInput && window.intlTelInput) {
    iti = window.intlTelInput(phoneInput, {
      initialCountry: 'il',
      separateDialCode: true,
      loadUtils: function () {
        return import('https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/js/utils.js');
      },
    });
  }

  // Consent checkbox — custom in-modal error instead of the browser's
  // native validation bubble (the checkbox carries no `required` attribute).
  var consentInput = form ? form.querySelector('input[name="consent"]') : null;
  var consentLabel = consentInput ? consentInput.closest('.modal-consent') : null;

  function showConsentError() {
    if (!consentLabel) return;
    consentLabel.classList.add('modal-consent--error');
    var err = form.querySelector('.modal-consent-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'modal-consent-error';
      err.setAttribute('role', 'alert');
      err.textContent = 'Please confirm you agree to be contacted so we can reach out.';
      consentLabel.insertAdjacentElement('afterend', err);
    }
    err.style.display = 'block';
  }

  function clearConsentError() {
    if (!consentLabel) return;
    consentLabel.classList.remove('modal-consent--error');
    var err = form.querySelector('.modal-consent-error');
    if (err) err.style.display = 'none';
  }

  if (consentInput) {
    consentInput.addEventListener('change', function () {
      if (consentInput.checked) clearConsentError();
    });
  }

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

  // Meta Pixel click-attribution cookies. _fbp is set by fbevents.js on
  // every visit; _fbc is set only when the user arrived via an `fbclid`
  // in the URL (i.e. clicked a Meta ad). Passing both server-side to CAPI
  // raises Meta's match rate from ~70% to ~90%.
  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      // Mandatory consent — show the in-modal error and stop if unchecked.
      if (consentInput && !consentInput.checked) {
        showConsentError();
        consentInput.focus();
        return;
      }

      var data = new FormData(form);
      // Full E.164 number when intl-tel-input + its utils are loaded;
      // falls back to the raw field value otherwise.
      var phoneValue = data.get('phone');
      if (iti && typeof iti.getNumber === 'function') {
        var fullNumber = iti.getNumber();
        if (fullNumber) phoneValue = fullNumber;
      }
      var payload = {
        name: data.get('name'),
        phone: phoneValue,
        email: data.get('email'),
        consent: data.get('consent') ? 'yes' : '',
        source: window.location.pathname,
        url: window.location.href,
        utm_source: qs('utm_source'),
        utm_medium: qs('utm_medium'),
        utm_campaign: qs('utm_campaign'),
        utm_content: qs('utm_content'),
        utm_term: qs('utm_term'),
        referrer: document.referrer,
        fbp: getCookie('_fbp'),
        fbc: getCookie('_fbc'),
      };

      // B2B variant (corporate.html): dedicated fields, dedicated endpoint.
      var company = data.get('company');
      var teamSize = data.get('team_size');
      var eventType = data.get('event_type');
      var isB2B = !!(company || teamSize || eventType);
      if (isB2B) {
        payload.company = company || '';
        payload.team_size = teamSize || '';
        payload.event_type = eventType || '';
        if (iti && typeof iti.getSelectedCountryData === 'function') {
          payload.phone_country = (iti.getSelectedCountryData().iso2 || '').toLowerCase();
        }
        delete payload.fbp;
        delete payload.fbc;
      }
      var endpoint = isB2B ? WEBHOOK_URL_CORPORATE : WEBHOOK_URL;
      // Canonical JSON — keys sorted alphabetically — so the HMAC we compute
      // here matches what n8n reproduces after its JSON-parse step.
      var body = JSON.stringify(payload, Object.keys(payload).sort());

      try {
        var signature = await signHmacSha256(body, WEBHOOK_SECRET);
        // Fire-and-forget — user sees success instantly regardless.
        fetch(endpoint, {
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
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        }).catch(function () {});
      }

      if (formWrap) formWrap.style.display = 'none';
      if (success) success.classList.add('show');

      // GTM: announce conversion so the Lead Submit + Meta Lead tags fire.
      // Fires on success-UI-shown (fire-and-forget on the network call, so
      // pushing here matches what the user sees).
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'lead_submitted',
        lead_source: 'contact_form',
        lead_page: window.location.pathname,
      });

      setTimeout(closeModal, 3000);
    });
  }
})();
