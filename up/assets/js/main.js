(function () {
  function o() {
    var t = document.getElementById("customVideo"),
      n = document.getElementById("videoOverlay");
    if (!t || !n) return;
    n.addEventListener("click", function () {
      n.style.opacity = "0";
      setTimeout(function () {
        try {
          t.muted = !1;
          t.currentTime = 0;
          t.play();
          n.style.display = "none";
        } catch (e) {
          n.style.opacity = "1";
        }
      }, 300);
    });
    t.addEventListener("ended", function () {
      n.style.display = "flex";
      n.style.opacity = "1";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof initBacktrap === "function") initBacktrap();
    o();
  });

  document.addEventListener("DOMContentLoaded", function () {
    var valorKey =
      typeof window.credpixStorageKey === "function"
        ? window.credpixStorageKey("valor_emprestimo")
        : "valor_emprestimo";
    var t = localStorage.getItem(valorKey);
    if (!t) return;
    var n;
    if (isNaN(t)) {
      var e = t
        .replace(/[^\d,.-]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      n = Number(e);
    } else n = Number(t);
    if (isNaN(n)) return;
    var o = n.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
      }),
      r = document.getElementById("limiteDisponivelValor");
    r && (r.innerText = o);
    var a = document.getElementById("tituloValor");
    a && (a.innerText = a.innerText.replace(/R\$\s?[\d\.,]+/, o));
    document
      .querySelectorAll("body *:not(script):not(style)")
      .forEach(function (t) {
        t.childNodes.forEach(function (t) {
          if (t.nodeType !== Node.TEXT_NODE) return;
          var e = t.textContent;
          if (!e) return;
          var r = e.replace(/R\$\s?4\.600(,00)?/g, o);
          r !== e && (t.textContent = r);
        });
      });
    var i = 117.53,
      l = n + i,
      u = l.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
      }),
      c = document.getElementById("valorReceber");
    c && (c.innerText = u);
    var d = document.getElementById("pixValor");
    d && (d.innerText = d.innerText.replace(/R\$\s?[\d\.,]+/, u));
  });

  /* Backtrap removido — botão voltar do navegador funciona normalmente,
     redirecionando o usuário para a página anterior real. */

  document.addEventListener(
    "contextmenu",
    function (t) {
      t.preventDefault();
    },
    !1
  );
  if (!("ontouchstart" in window) && window.matchMedia("(hover: hover)").matches) {
    document.addEventListener(
      "selectstart",
      function (t) {
        t.preventDefault();
      },
      !1
    );
  }
  document.addEventListener(
    "dragstart",
    function (t) {
      t.preventDefault();
    },
    !1
  );
  document.addEventListener(
    "keydown",
    function (t) {
      if ("F12" === t.key) return t.preventDefault(), t.stopPropagation(), !1;
      if (
        t.ctrlKey &&
        t.shiftKey &&
        ["I", "J", "C"].includes(t.key.toUpperCase())
      )
        return t.preventDefault(), t.stopPropagation(), !1;
      if (t.ctrlKey && ["U", "S"].includes(t.key.toUpperCase()))
        return t.preventDefault(), t.stopPropagation(), !1;
    },
    !1
  );
})();

(function () {
  var e = document.createElement("link");
  e.rel = "icon";
  e.type = "image/svg+xml";
  var href;
  try {
    href = new URL("../img/fav.svg", document.currentScript && document.currentScript.src
      ? document.currentScript.src
      : window.location.href).href;
  } catch (err) {
    href = "../assets/img/credpix-logo.png";
  }
  if (typeof window.credpixPath === "function") {
    try {
      href = window.credpixPath("/up/assets/img/credpix-logo.png");
    } catch (e2) {}
  }
  e.href = href;
  document.head.appendChild(e);
})();
