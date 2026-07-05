document.addEventListener('DOMContentLoaded', () => {
  const hoursElements = document.querySelectorAll('.js-timer-hours');
  const minutesElements = document.querySelectorAll('.js-timer-minutes');
  const secondsElements = document.querySelectorAll('.js-timer-seconds');

  function updateTimers() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const distance = tomorrow - now;

    let hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    let minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    let seconds = Math.floor((distance % (1000 * 60)) / 1000);

    hours = hours < 10 ? '0' + hours : hours;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;

    hoursElements.forEach(el => el.textContent = hours);
    minutesElements.forEach(el => el.textContent = minutes);
    secondsElements.forEach(el => el.textContent = seconds);
  }

  updateTimers();
  setInterval(updateTimers, 1000);
});
// === CRO: Social Proof Toast ===
(function() {
  var toast = document.getElementById('socialProofToast');
  if (!toast) return;
  
  var messages = [
    'Bugun <strong>47</strong> ta to\'plam sotildi!',
    '<strong>Shahlo</strong> (Toshkent) hozirgina buyurtma berdi',
    'So\'nggi 1 soatda <strong>12</strong> ta buyurtma',
    '<strong>Nodira</strong> (Namangan) hozirgina buyurtma berdi',
    'Bugun <strong>89</strong> kishi sahifani ko\'rdi'
  ];
  var icons = ['🔥', '✅', '📦', '✅', '👀'];
  var idx = 0;
  
  function showToast() {
    toast.querySelector('.toast-text').innerHTML = messages[idx];
    toast.querySelector('.toast-icon').textContent = icons[idx];
    toast.classList.add('show');
    setTimeout(function() {
      toast.classList.remove('show');
    }, 4000);
    idx = (idx + 1) % messages.length;
  }
  
  // First show after 8 seconds
  setTimeout(function() {
    showToast();
    // Then every 25 seconds
    setInterval(showToast, 25000);
  }, 8000);
})();

// === CRO: Hide sticky CTA when form is visible ===
(function() {
  var stickyBar = document.querySelector('.sticky-cta-bar');
  if (!stickyBar) return;
  
  var forms = document.querySelectorAll('.order_form');
  var lastForm = forms[forms.length - 1];
  if (!lastForm) return;
  
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        stickyBar.style.transform = 'translateY(100%)';
        stickyBar.style.transition = 'transform 0.3s ease';
      } else {
        stickyBar.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.3 });
  
  observer.observe(lastForm);
})();
