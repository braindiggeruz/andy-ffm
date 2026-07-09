// andy-ffm landing (Barmoqli paypoqlar) — vanilla JS.
// Same Meta event contract as savdomix-ultrasonic-repeller:
//   PageView    : once on load (browser + server CAPI, same event_id dedup)
//   ViewContent : once on load (browser + server CAPI, same event_id dedup)
//   FormStart   : custom, once, on first focus/input of name or phone
//   valid submit: exactly one InitiateCheckout (browser + server CAPI, same event_id)
//   BUYO accept : browser Lead + server CAPI Lead — SAME event_id → dedup, then redirect to thanks.html
//   BUYO reject : NO Lead

(function () {
  "use strict";
  var $ = function (s, e) { return (e || document).querySelector(s); };
  var $$ = function (s, e) { return Array.prototype.slice.call((e || document).querySelectorAll(s)); };
  var IS_THANKS = document.body && document.body.getAttribute("data-page") === "thanks";

  function uuidv4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20,32);
  }
  function setCookie(n, v, d) { var e = new Date(Date.now() + d * 864e5).toUTCString(); document.cookie = n + "=" + encodeURIComponent(v) + "; expires=" + e + "; path=/; SameSite=Lax"; }
  function getCookie(n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n.replace(/[.$?*|{}()\[\]\\\/+^]/g, "\\$&") + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; }

  // --- attribution ---
  var ATTR_KEYS = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","campaign_id","adset_id","ad_id","placement","fbclid"];
  var STORAGE_KEY = "affm_attr_v1";
  function captureAttribution() {
    var params = new URL(window.location.href).searchParams;
    var stored = null; try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (e) { stored = null; }
    var next = stored && typeof stored === "object" ? Object.assign({}, stored) : {};
    var updated = false;
    ATTR_KEYS.forEach(function (k) { var v = params.get(k); if (v && (!next[k] || k === "fbclid")) { next[k] = v.slice(0, 256); updated = true; } });
    next.landing_url = window.location.href; next.referrer = document.referrer || null;
    if (!stored || updated) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) {} }
    var fbp = getCookie("_fbp");
    if (!fbp) { fbp = "fb.1." + Date.now() + "." + Math.floor(Math.random()*1e10); setCookie("_fbp", fbp, 90); }
    var fbc = getCookie("_fbc");
    var fbclidForFbc = params.get("fbclid") || next.fbclid || (stored && stored.fbclid) || null;
    if (!fbc && fbclidForFbc) { fbc = "fb.1." + Date.now() + "." + fbclidForFbc; setCookie("_fbc", fbc, 90); }
    next._fbp = fbp || null; next._fbc = fbc || null;
    return next;
  }
  function getAttrs() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (e) { return {}; } }

  // --- stable anonymous external_id (Advanced Matching) ---
  var EXT_ID_KEY = "affm_xid_v1";
  function getExternalId() {
    var id = null;
    try { id = localStorage.getItem(EXT_ID_KEY); } catch (e) {}
    if (!id) {
      id = uuidv4();
      try { localStorage.setItem(EXT_ID_KEY, id); } catch (e) {}
      try { setCookie(EXT_ID_KEY, id, 365); } catch (e) {}
    }
    return id;
  }

  // --- telemetry ---
  function track(event, extra) {
    var body = JSON.stringify(Object.assign({ event: event, ts: Date.now(), page: window.location.pathname, attrs: getAttrs() }, extra || {}));
    try { if (navigator.sendBeacon) { navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" })); return; } } catch (e) {}
    fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
  }

  // --- Meta Pixel ---
  var FIRED = { PageView: false, ViewContent: false, InitiateCheckout: false, Lead: false };
  // Pixel ID hardcoded as fallback (same as noscript tag) so PageView/ViewContent
  // fire IMMEDIATELY without waiting for the /api/config network round-trip.
  // /api/config still loads and can override value/mock_mode for the Lead flow.
  var CONFIG = { pixel_id: "2935651803447339", value: 135000, currency: "UZS", content_name: "Barmoqli paypoqlar (3 juft)", content_id: "toe-socks-3pairs-v1", mock_mode: false };

  function pixelInit() {
    if (!window.fbq || !CONFIG.pixel_id) return;
    if (!window.__fbq_inited__) {
      var am = {};
      try { var xid = getExternalId(); if (xid) am.external_id = xid; } catch (e) {}
      am.country = "uz";
      try { fbq("init", CONFIG.pixel_id, am); } catch (e) { fbq("init", CONFIG.pixel_id); }
      window.__fbq_inited__ = true;
    }
  }
  function sendServerEvent(eventName, eventId) {
    try {
      var attrs = getAttrs();
      var payload = JSON.stringify({
        event_name: eventName,
        client_event_id: eventId,
        external_id: getExternalId(),
        attrs: { _fbp: attrs._fbp || null, _fbc: attrs._fbc || null, fbclid: attrs.fbclid || null, landing_url: attrs.landing_url || window.location.href },
      });
      fetch("/api/track-event", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, credentials: "same-origin" }).catch(function () {});
    } catch (e) {}
  }
  function firePageView() {
    if (FIRED.PageView || !window.fbq) return; pixelInit();
    var eid = uuidv4();
    fbq("track", "PageView", {}, { eventID: eid });
    sendServerEvent("PageView", eid);
    FIRED.PageView = true;
  }
  function fireViewContent() {
    if (FIRED.ViewContent || !window.fbq) return; pixelInit();
    var eid = uuidv4();
    fbq("track", "ViewContent", { content_name: CONFIG.content_name, content_category: "apparel", content_ids: [CONFIG.content_id], content_type: "product", value: CONFIG.value, currency: CONFIG.currency }, { eventID: eid });
    sendServerEvent("ViewContent", eid);
    FIRED.ViewContent = true;
  }
  function fireInitiateCheckout(eventId) {
    if (FIRED.InitiateCheckout || !window.fbq) return; pixelInit();
    fbq("track", "InitiateCheckout", { content_name: CONFIG.content_name, content_ids: [CONFIG.content_id], num_items: 1, value: CONFIG.value, currency: CONFIG.currency }, { eventID: eventId });
    FIRED.InitiateCheckout = true;
  }
  function fireLead(eventId) {
    if (FIRED.Lead || !window.fbq) return; pixelInit();
    fbq("track", "Lead", { content_name: CONFIG.content_name, content_ids: [CONFIG.content_id], num_items: 1, value: CONFIG.value, currency: CONFIG.currency }, { eventID: eventId });
    FIRED.Lead = true;
  }

  function sendServerInitiateCheckout(eventId, leadBody) {
    try {
      var payload = JSON.stringify({
        client_event_id: eventId,
        name: leadBody.name || null,
        phone: leadBody.phone || null,
        email: leadBody.email || null,
        external_id: leadBody.external_id || null,
        order_value: leadBody.order_value || CONFIG.value,
        quantity: leadBody.quantity || 1,
        attrs: {
          _fbp: (leadBody.attrs && leadBody.attrs._fbp) || null,
          _fbc: (leadBody.attrs && leadBody.attrs._fbc) || null,
          fbclid: (leadBody.attrs && leadBody.attrs.fbclid) || null,
          landing_url: (leadBody.attrs && leadBody.attrs.landing_url) || window.location.href,
        },
      });
      fetch("/api/track-ic", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, credentials: "same-origin" }).catch(function () {});
    } catch (e) {}
  }

  // --- public config + landing prices ---
  function loadConfig() {
    return fetch("/api/config", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (c) Object.assign(CONFIG, c); })
      .catch(function () {});
  }
  function setText(selectors, value) {
    if (value == null || value === "") return;
    selectors.split(",").forEach(function (sel) {
      $$(sel.trim()).forEach(function (el) { el.textContent = String(value); });
    });
  }
  function computeOld(cfg) {
    if (cfg.price_old != null && cfg.price_old !== "") return;
    if (cfg.price_new == null || cfg.sale == null) return;
    var pn = Number(String(cfg.price_new).replace(/\s+/g, ""));
    var sale = Number(cfg.sale);
    if (!isFinite(pn) || !isFinite(sale) || sale < 0 || sale > 99) return;
    cfg.price_old = Math.floor((pn / (100 - sale)) * 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  function fillPrices(cfg) {
    computeOld(cfg);
    setText('[data-price-new]', cfg.price_new);
    setText('[data-currency]', cfg.currency);
    var hasOld = cfg.price_old != null && String(cfg.price_old).trim() !== "";
    if (hasOld) {
      setText('[data-price-old]', cfg.price_old);
      setText('[data-sale]', cfg.sale);
    } else {
      // No honest anchor price configured → hide the struck-through old row
      // so the block shows one clean price instead of an empty "Oddiy narx".
      $$('.price-item.old').forEach(function (el) { el.style.display = 'none'; });
    }
    var pn = Number(String(cfg.price_new || "").replace(/\s+/g, ""));
    if (isFinite(pn) && pn > 0) CONFIG.value = pn;
  }
  function loadCfgPrices() {
    return fetch("/api/cfg", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (cfg && typeof cfg === "object" && cfg.price_new != null) { fillPrices(cfg); return; }
        throw new Error("no_cfg");
      })
      .catch(function () {
        // Fallback: derive from /api/config so the price ALWAYS renders,
        // even if /api/cfg is unavailable.
        fillPrices({ price_new: fmtInt(CONFIG.value || 135000), currency: "so'm" });
      });
  }

  // --- validation (same rules as server) ---
  var NAME_RE = /^[A-Za-z\u0400-\u04FF\u02BB\u02BC\u2018\u2019' \-\u02B9]{2,40}$/;
  var OPS = ["33","50","55","61","62","65","66","67","69","70","71","72","73","74","75","76","77","78","79","88","90","91","93","94","95","97","98","99"];
  function normDigits(raw) {
    var d = String(raw || "").replace(/\D+/g, "");
    if (d.indexOf("00998") === 0) d = d.slice(2);
    if (d.length === 10 && d.charAt(0) === "8") d = d.slice(1);
    if (d.indexOf("998") === 0) d = d.slice(3);
    return d.slice(0, 9);
  }
  function validateName(v) {
    var s = String(v || "").trim();
    if (s.length < 2) return { ok: false, msg: "To'g'ri ism kiriting (kamida 2 harf)." };
    if (s.length > 40) return { ok: false, msg: "Ism juda uzun." };
    if (!NAME_RE.test(s)) return { ok: false, msg: "Ismda faqat harflar bo'lishi mumkin." };
    return { ok: true, value: s };
  }
  function validatePhone(d) {
    if (!d || d.length !== 9) return { ok: false, msg: "Telefon raqamingizni to'liq kiriting (masalan: 90 123 45 67)." };
    if (OPS.indexOf(d.slice(0, 2)) === -1) return { ok: false, msg: "Telefon raqami formati noto'g'ri." };
    return { ok: true, value: "998" + d };
  }

  // --- phone mask formatting ---
  function formatPhoneInput(val) {
    var d = String(val || "").replace(/\D+/g, "");
    if (d.indexOf("00998") === 0) d = d.slice(2);
    if (d.length === 10 && d.charAt(0) === "8") d = d.slice(1);
    if (d.indexOf("998") === 0) d = d.slice(3);
    d = d.slice(0, 9);
    if (d.length === 0) return "";
    if (d.length <= 2) return "+998 " + d;
    if (d.length <= 5) return "+998 " + d.slice(0, 2) + " " + d.slice(2);
    if (d.length <= 7) return "+998 " + d.slice(0, 2) + " " + d.slice(2, 5) + " " + d.slice(5);
    return "+998 " + d.slice(0, 2) + " " + d.slice(2, 5) + " " + d.slice(5, 7) + " " + d.slice(7);
  }

  // --- inline form errors (replaces alert) ---
  function clearFieldError(el) {
    if (!el) return;
    el.classList.remove("field--error");
    var next = el.nextElementSibling;
    if (next && next.className === "field-error") next.parentNode.removeChild(next);
  }
  function showFieldError(el, msg) {
    if (!el) return;
    clearFieldError(el);
    el.classList.add("field--error");
    var div = document.createElement("div");
    div.className = "field-error";
    div.textContent = msg;
    el.parentNode.insertBefore(div, el.nextSibling);
    try { el.focus(); } catch (e) {}
  }
  function showFormError(form, msg) {
    var box = form.querySelector(".form-error-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "form-error-box";
      var btn = form.querySelector('[type="submit"]');
      form.insertBefore(box, btn ? btn.nextSibling : null);
    }
    box.textContent = msg;
  }
  function clearFormError(form) {
    var box = form.querySelector(".form-error-box");
    if (box) box.parentNode.removeChild(box);
  }

  // --- FormStart (once) — browser + server CAPI mirror, same event_id dedup ---
  var formStartFired = false;
  function fireFormStartOnce() {
    if (formStartFired) return;
    formStartFired = true;
    var eid = uuidv4();
    if (window.fbq) {
      pixelInit();
      fbq("trackCustom", "FormStart", {}, { eventID: eid });
    }
    sendServerEvent("FormStart", eid);
    track("form_start", { event_id: eid });
  }

  // --- submit ---
  var submitInFlight = false;
  function bindForms() {
    $$("form.order_form").forEach(function (form) {
      form.removeAttribute("action");
      form.removeAttribute("method");

      var nameEl = form.querySelector('input[name="name"]');
      var phoneEl = form.querySelector('input[name="phone"]');
      var progressBar = form.querySelector('#form_progress');
      
      // Update progress bar on input
      function updateProgress() {
        if (!progressBar) return;
        var nameVal = nameEl && nameEl.value.trim() ? 50 : 0;
        var phoneVal = phoneEl && phoneEl.value.trim().length >= 7 ? 50 : 0;
        var total = nameVal + phoneVal;
        progressBar.style.width = total + '%';
      }
      
      // Apply phone mask formatting
      if (phoneEl) {
        phoneEl.addEventListener("input", function (e) {
          var formatted = formatPhoneInput(e.target.value);
          e.target.value = formatted;
          clearFieldError(phoneEl);
          updateProgress();
        });
        // Auto-focus phone field on name blur
        if (nameEl) {
          nameEl.addEventListener("blur", function () {
            if (nameEl.value.trim() && !phoneEl.value) {
              phoneEl.focus();
            }
          });
        }
      }
      
      // Add progress update to name input
      if (nameEl) {
        nameEl.addEventListener("input", function () {
          clearFieldError(nameEl);
          updateProgress();
        });
      }
      
      [nameEl, phoneEl].forEach(function (el) {
        if (!el) return;
        el.addEventListener("focus", fireFormStartOnce, { once: true });
        el.addEventListener("input", fireFormStartOnce, { once: true });
      });

      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (submitInFlight) return;

        clearFieldError(nameEl); clearFieldError(phoneEl); clearFormError(form);

        var nameCheck = validateName(nameEl ? nameEl.value : "");
        if (!nameCheck.ok) { showFieldError(nameEl, nameCheck.msg); return; }
        var phoneCheck = validatePhone(normDigits(phoneEl ? phoneEl.value : ""));
        if (!phoneCheck.ok) { showFieldError(phoneEl, phoneCheck.msg); return; }

        var attrs = getAttrs();
        var eventId = uuidv4();
        var body = {
          name: nameCheck.value,
          phone: "+" + phoneCheck.value,
          attrs: {
            utm_source: attrs.utm_source || null, utm_medium: attrs.utm_medium || null,
            utm_campaign: attrs.utm_campaign || null, utm_term: attrs.utm_term || null, utm_content: attrs.utm_content || null,
            campaign_id: attrs.campaign_id || null, adset_id: attrs.adset_id || null, ad_id: attrs.ad_id || null,
            placement: attrs.placement || null, fbclid: attrs.fbclid || null,
            _fbp: attrs._fbp || null, _fbc: attrs._fbc || null,
            landing_url: attrs.landing_url || window.location.href,
            client_ua: navigator.userAgent || null,
          },
          external_id: getExternalId(),
          client_event_id: eventId,
        };

        // Advanced Matching upgrade: pass phone+first name to the browser pixel
        // (fbq hashes them client-side) so IC/Lead get max Event Match Quality.
        try {
          if (window.fbq && CONFIG.pixel_id) {
            fbq("init", CONFIG.pixel_id, {
              ph: phoneCheck.value,
              fn: nameCheck.value.split(/\s+/)[0].toLowerCase(),
              external_id: getExternalId(),
              country: "uz",
            });
          }
        } catch (e) {}

        // InitiateCheckout — once, valid submit only. Browser + server CAPI, same event_id.
        fireInitiateCheckout(eventId);
        sendServerInitiateCheckout(eventId, body);
        track("valid_submit", { event_id: eventId });

        submitInFlight = true;
        var btn = form.querySelector('[type="submit"]') || form.querySelector("button");
        var btnLabel = btn ? btn.textContent : "";
        if (btn) { btn.disabled = true; btn.textContent = "Yuborilmoqda…"; }

        function resetBtn() {
          submitInFlight = false;
          if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        }

        track("api_started");
        // One automatic retry for TRANSIENT failures only (BUYO 5xx / rate
        // limit / network). Safe: the server dedupes by submission_id in D1,
        // and InitiateCheckout has already fired exactly once above.
        var RETRYABLE = { buyo_5xx: 1, rate_limit: 1, network_error: 1 };
        function submitLead(attempt) {
          fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" })
            .then(function (resp) {
              return resp.json().catch(function () { return {}; }).then(function (data) { return { resp: resp, data: data }; });
            })
            .then(function (r) {
              if (r.resp.ok && r.data && r.data.accepted) {
                var eid = r.data.event_id || eventId;
                if (CONFIG.mock_mode || r.data.mode === "mock") {
                  track("mock_buyo_accepted", { event_id: eid });
                } else {
                  fireLead(eid);
                  track("buyo_accepted", { event_id: eid });
                  track("lead_success", { event_id: eid });
                }
                // Give the pixel a moment to flush, then go to the thank-you page.
                setTimeout(function () { window.location.href = "/thanks"; }, 450);
              } else {
                var code = (r.data && r.data.code) || "unknown";
                if (RETRYABLE[code] && attempt === 0) {
                  track("lead_retry", { code: code });
                  if (btn) btn.textContent = "Qayta urinilmoqda…";
                  setTimeout(function () { submitLead(1); }, 2500);
                  return;
                }
                track("buyo_rejected", { http: r.resp.status, code: code });
                showFormError(form, "Buyurtmani yuborib bo'lmadi. Iltimos, bir oz kutib \"BUYURTMA BERISH\" tugmasini qayta bosing.");
                resetBtn();
              }
            })
            .catch(function () {
              if (attempt === 0) {
                track("lead_retry", { code: "fetch_error" });
                if (btn) btn.textContent = "Qayta urinilmoqda…";
                setTimeout(function () { submitLead(1); }, 2500);
                return;
              }
              track("api_error");
              showFormError(form, "Ulanish bilan muammo. Internet aloqasini tekshirib qayta urinib ko'ring.");
              resetBtn();
            });
        }
        submitLead(0);
      });
    });
  }

  // --- FAQ Accordion ---
  function initFAQ() {
    var faqItems = document.querySelectorAll(".faq-item");
    faqItems.forEach(function (item) {
      var question = item.querySelector(".faq-question");
      if (question) {
        question.addEventListener("click", function () {
          var isActive = item.classList.contains("active");
          faqItems.forEach(function (otherItem) {
            otherItem.classList.remove("active");
          });
          if (!isActive) {
            item.classList.add("active");
          }
        });
      }
    });
  }

  // --- Live Feed (Social Proof) ---
  function initLiveFeed() {
    var container = $("#live_feed_container");
    if (!container) return;
    var names = ["Aziza", "Murod", "Gulnoza", "Farrux", "Dilnoza", "Rustam", "Laylo", "Qodirjon"];
    var cities = ["Toshkent", "Samarqand", "Buxoro", "Andijon", "Qo'qon", "Namangan", "Jizzax", "Qashqadaryo"];
    var intervals = [1, 5, 12, 20, 35, 50];
    setInterval(function () {
      var randomName = names[Math.floor(Math.random() * names.length)];
      var randomCity = cities[Math.floor(Math.random() * cities.length)];
      var randomInterval = intervals[Math.floor(Math.random() * intervals.length)];
      var newItem = document.createElement("div");
      newItem.className = "live-feed-item";
      var avatar = randomName.charAt(0);
      newItem.innerHTML = '<div class="feed-avatar">' + avatar + '</div><div class="feed-content"><p class="feed-text"><strong>' + randomName + '</strong> ' + randomCity + ' — buyurtma qildi</p><span class="feed-time">' + randomInterval + ' daqiqa oldin</span></div><span class="feed-badge">✓</span>';
      container.insertBefore(newItem, container.firstChild);
      if (container.children.length > 3) {
        container.removeChild(container.lastChild);
      }
    }, 8000 + Math.random() * 4000);
  }

  function boot() {
    captureAttribution();
    // Fire pixel events IMMEDIATELY (pixel_id is a static fallback) — recovers
    // signal from fast-bouncing mobile users who leave before /api/config returns.
    pixelInit();
    firePageView();
    if (!IS_THANKS) fireViewContent();
    loadConfig().then(function () {
      initFAQ();
      initLiveFeed();
    });
    if (!IS_THANKS) {
      loadCfgPrices();
      bindForms();
      track("landing_view");
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
