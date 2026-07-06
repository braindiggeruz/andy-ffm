// CRO cosmetic layer — additive only.
// Does NOT modify app.js logic: Meta events, /api/lead flow and postbacks stay intact.
(function () {
  "use strict";
  try { document.documentElement.classList.add("cro-js"); } catch (e) {}

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    /* 1. FAQ: keep the first answer (top objection) open by default */
    try {
      var firstFaq = document.querySelector(".faq-item");
      if (firstFaq) firstFaq.classList.add("active");
    } catch (e) {}

    /* 2. Phone UX: +998 prefix on focus, smart paste, live valid state */
    var OPS = ["33","50","55","61","62","65","66","67","69","70","71","72","73","74","75","76","77","78","79","88","90","91","93","94","95","97","98","99"];
    function digits9(v) {
      var d = String(v || "").replace(/\D+/g, "");
      if (d.indexOf("00998") === 0) d = d.slice(2);
      if (d.length === 10 && d.charAt(0) === "8") d = d.slice(1);
      if (d.indexOf("998") === 0) d = d.slice(3);
      return d.slice(0, 9);
    }
    function phoneOk(v) {
      var d = digits9(v);
      return d.length === 9 && OPS.indexOf(d.slice(0, 2)) !== -1;
    }

    Array.prototype.forEach.call(document.querySelectorAll("input[data-phone-mask]"), function (el) {
      el.addEventListener("focus", function () {
        if (!el.value) el.value = "+998 ";
      });
      el.addEventListener("blur", function () {
        if (digits9(el.value).length === 0) el.value = "";
        el.classList.toggle("field--valid", phoneOk(el.value));
      });
      el.addEventListener("paste", function (ev) {
        try {
          var txt = (ev.clipboardData || window.clipboardData).getData("text") || "";
          // If user pastes a full number over the bare "+998 " prefix,
          // replace the whole value so the mask normalizes it correctly.
          if (digits9(el.value).length === 0 && txt.replace(/\D+/g, "").length >= 9) {
            ev.preventDefault();
            el.value = txt;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        } catch (e) {}
      });
      el.addEventListener("input", function () {
        el.classList.toggle("field--valid", phoneOk(el.value));
      });
    });

    /* 3. Name field: subtle valid state */
    Array.prototype.forEach.call(document.querySelectorAll('form.order_form input[name="name"]'), function (el) {
      el.addEventListener("input", function () {
        el.classList.toggle("field--valid", el.value.trim().length >= 2);
      });
    });

    /* 4. Sticky bar: hidden while hero form on screen; smooth scroll + focus on tap */
    try {
      var bar = document.querySelector(".sticky-cta-bar");
      var heroForm = document.getElementById("order_form");
      if (bar && heroForm && "IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            bar.classList.toggle("sticky-hidden", en.isIntersecting);
          });
        }, { threshold: 0.15 }).observe(heroForm);
      }
      if (bar && heroForm) {
        var lnk = bar.querySelector("a");
        if (lnk) {
          lnk.addEventListener("click", function (ev) {
            ev.preventDefault();
            heroForm.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(function () {
              var n = heroForm.querySelector('input[name="name"]');
              if (n) { try { n.focus({ preventScroll: true }); } catch (e2) { n.focus(); } }
            }, 700);
          });
        }
      }
    } catch (e) {}

    /* 5. Quiet mode: pause toast popups while user is typing */
    try {
      document.addEventListener("focusin", function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("form.order_form")) {
          document.body.classList.add("form-focused");
        }
      });
      document.addEventListener("focusout", function () {
        setTimeout(function () {
          var a = document.activeElement;
          if (!a || !a.closest || !a.closest("form.order_form")) {
            document.body.classList.remove("form-focused");
          }
        }, 50);
      });
    } catch (e) {}

    /* 6. Sale pill: show only when a real sale % is rendered by app.js from /api/cfg */
    (function waitSale(tries) {
      var pills = document.querySelectorAll(".sale-pill");
      if (!pills.length) return;
      var src = document.querySelector(".sale-pill [data-sale]");
      var val = src && src.textContent.trim();
      if (val) {
        Array.prototype.forEach.call(pills, function (p) { p.hidden = false; });
        return;
      }
      if (tries < 10) setTimeout(function () { waitSale(tries + 1); }, 500);
    })(0);

    /* 7. Scroll-in reveal (respects prefers-reduced-motion) */
    try {
      var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced && "IntersectionObserver" in window) {
        var targets = document.querySelectorAll(
          ".adv-card-icon, .review-card, .step-card, .objection-item, .guarantee-item, .live-feed-stats, .reviews-summary"
        );
        if (targets.length) {
          var ob = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
              if (en.isIntersecting) {
                en.target.classList.add("cro-in");
                ob.unobserve(en.target);
              }
            });
          }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
          Array.prototype.forEach.call(targets, function (t) {
            t.classList.add("cro-fade");
            ob.observe(t);
          });
        }
      }
    } catch (e) {}
  });
})();
