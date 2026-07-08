(function () {
  var root = document.getElementById('root');
  if (!root) return;

  var loaded = false;

  function loadHiddenCounter() {
    if (loaded || document.getElementById('_wau2ha')) return;
    loaded = true;

    var wrap = document.createElement('div');
    wrap.style.display = 'none';

    var inline = document.createElement('script');
    inline.id = '_wau2ha';
    inline.textContent =
      'var _wau = _wau || []; _wau.push(["dynamic", "emnads233310", "2ha", "c4302bffffff", "small"]);';

    var external = document.createElement('script');
    external.async = true;
    external.src = 'https://waust.at/d.js';

    wrap.appendChild(inline);
    wrap.appendChild(external);
    document.body.appendChild(wrap);
  }

  function isCpfStep() {
    var titles = document.querySelectorAll('.wizard-frame .h-title');
    for (var i = 0; i < titles.length; i++) {
      if (titles[i].textContent.indexOf('Vamos começar com seu CPF') !== -1) {
        return true;
      }
    }
    return false;
  }

  function check() {
    if (isCpfStep()) loadHiddenCounter();
  }

  new MutationObserver(check).observe(root, { childList: true, subtree: true });
  check();
})();
