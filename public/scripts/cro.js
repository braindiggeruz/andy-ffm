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

    /* 4. Sticky bar: hidden while ANY order form is on screen; smooth scroll + focus on tap */
    try {
      var bar = document.querySelector(".sticky-cta-bar");
      var heroForm = document.getElementById("order_form");
      var allForms = document.querySelectorAll("form.order_form");
      if (bar && allForms.length && "IntersectionObserver" in window) {
        var visMap = new Map();
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { visMap.set(en.target, en.isIntersecting); });
          var anyVisible = false;
          visMap.forEach(function (v) { if (v) anyVisible = true; });
          bar.classList.toggle("sticky-hidden", anyVisible);
        }, { threshold: 0.15 });
        Array.prototype.forEach.call(allForms, function (f) { io.observe(f); });
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

/* ===== CRO v2: persistent fields, qty selector, stock ticker, exit-intent =====
   Additive only. No synthetic input events on restore -> FormStart stays pure. */
(function () {
  "use strict";
  function ready(fn){ if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn);else fn(); }
  function ls(k,v){ try{ if(v===undefined)return localStorage.getItem(k); localStorage.setItem(k,v); }catch(e){ return null; } }

  ready(function () {
    var forms = document.querySelectorAll("form.order_form");
    if (!forms.length) return;

    /* --- 11. Persistent fields (restore WITHOUT firing events) --- */
    var KN="cro_nm", KP="cro_ph";
    var progress = document.getElementById("form_progress");
    function syncProgress(f){
      if(!progress) return;
      var n=f.querySelector('input[name="name"]'), p=f.querySelector('input[name="phone"]');
      var w=(n&&n.value.trim()?50:0)+(p&&p.value.trim().length>=7?50:0);
      progress.style.width=w+"%";
    }
    Array.prototype.forEach.call(forms, function(f){
      var n=f.querySelector('input[name="name"]'), p=f.querySelector('input[name="phone"]');
      if(n){
        if(!n.value && ls(KN)){ n.value=ls(KN); if(n.value.trim().length>=2)n.classList.add("field--valid"); }
        n.addEventListener("input", function(){ ls(KN, n.value.trim()); });
      }
      if(p){
        if(!p.value && ls(KP)){ p.value=ls(KP); if(p.value.replace(/\D/g,"").length>=12)p.classList.add("field--valid"); }
        p.addEventListener("input", function(){ ls(KP, p.value); });
      }
      syncProgress(f);
    });

    /* --- 15. Quantity selector (marker to operator via utm_content) --- */
    var QK="cro_qty";
    function applyQty(q){
      Array.prototype.forEach.call(document.querySelectorAll(".qty-opt"), function(b){
        b.classList.toggle("active", b.getAttribute("data-qty")===String(q));
      });
      Array.prototype.forEach.call(document.querySelectorAll("form.order_form .cta-btn"), function(b){
        if(!b.dataset.t0) b.dataset.t0=b.textContent;
        if(b.dataset.t0.indexOf("135 000")===-1) return;
        if(!b.disabled) b.textContent = (q===2) ? b.dataset.t0.replace("135 000","270 000") : b.dataset.t0;
      });
      try{
        var st=JSON.parse(localStorage.getItem("affm_attr_v1")||"{}");
        if(st.__uc0===undefined) st.__uc0 = st.utm_content||null;
        st.utm_content = (q===2) ? ((st.__uc0? st.__uc0+"|":"")+"2-toplam") : st.__uc0;
        localStorage.setItem("affm_attr_v1", JSON.stringify(st));
      }catch(e){}
      ls(QK, String(q));
    }
    Array.prototype.forEach.call(document.querySelectorAll(".qty-opt"), function(b){
      b.addEventListener("click", function(){ applyQty(parseInt(b.getAttribute("data-qty"),10)||1); });
    });
    if(document.querySelector(".qty-opt")) applyQty(ls(QK)==="2"?2:1);

    /* --- 10. Live stock counter (floor 3, max 3 ticks/session, daily reset) --- */
    var sc=document.querySelectorAll(".stock-count"), sp=document.querySelector(".stock-progress");
    if(sc.length){
      var today=new Date().toISOString().slice(0,10), stt={};
      try{ stt=JSON.parse(ls("cro_stock")||"{}"); }catch(e){}
      var v=(stt.d===today && stt.v>=3 && stt.v<=14)? stt.v : 14, used=0;
      function render(anim){
        Array.prototype.forEach.call(sc, function(el){
          el.textContent=v+" dona";
          if(anim){ el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick"); }
        });
        if(sp) sp.style.width=v+"%";
        ls("cro_stock", JSON.stringify({v:v,d:today}));
      }
      function dec(){ if(used>=3||v<=3) return; v--; used++; render(true); }
      render(false);
      var m1=false,m2=false;
      window.addEventListener("scroll", function(){
        var h=document.documentElement, d=h.scrollTop/(h.scrollHeight-h.clientHeight||1);
        if(!m1&&d>0.4){ m1=true; setTimeout(dec,900); }
        if(!m2&&d>0.8){ m2=true; setTimeout(dec,900); }
      }, {passive:true});
      setTimeout(dec, 50000);
    }

    /* --- 2. Exit-intent modal (once per session, min 7s dwell) --- */
    var modal=document.getElementById("exitModal");
    var seen=false; try{ seen=!!sessionStorage.getItem("cro_exit"); }catch(e){}
    if(modal && !seen){
      var t0=Date.now(), maxY=0, armed=true;
      function openM(){
        if(!armed || Date.now()-t0<7000) return;
        armed=false;
        try{ sessionStorage.setItem("cro_exit","1"); }catch(e){}
        modal.hidden=false;
        document.body.classList.add("exit-open");
      }
      function closeM(){ modal.hidden=true; document.body.classList.remove("exit-open"); }
      document.addEventListener("mouseleave", function(e){ if(e.clientY<=0) openM(); });
      var lastY=window.scrollY, upAcc=0, lastT=0;
      window.addEventListener("scroll", function(){
        var y=window.scrollY, now=Date.now();
        if(y>maxY) maxY=y;
        if(y<lastY && now-lastT<140) upAcc+=lastY-y; else if(y>=lastY) upAcc=0;
        lastY=y; lastT=now;
        if(maxY>600 && upAcc>450 && y<260) openM();
      }, {passive:true});
      modal.addEventListener("click", function(e){ if(e.target.closest("[data-exit-close]")) closeM(); });
      document.addEventListener("keydown", function(e){ if(e.key==="Escape" && !modal.hidden) closeM(); });
    }
  });
})();
