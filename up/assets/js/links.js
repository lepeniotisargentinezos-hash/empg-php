(function () {
  /* Amung upsell: site-base.php?counter_slot=upsell + credpix-view-counter.php no <head> */

  const BASE_LINKS = {
    up1:  "/pay/checkout.php?produto=prod_698630b497231",
    up2:  "/pay/checkout.php?produto=prod_698630bd7f9da",
    up3:  "/pay/checkout.php?produto=prod_698630c55ec79",
    up4:  "/pay/checkout.php?produto=prod_698630ccf2e75",
    up5:  "/pay/checkout.php?produto=prod_698630d77a0fa",
    up6:  "/pay/checkout.php?produto=prod_698630dfecd3d",
    up7:  "/pay/checkout.php?produto=prod_698630e72dede",
    up8:  "/pay/checkout.php?produto=prod_698630eebfb78",
    up9:  "/pay/checkout.php?produto=prod_698630f633cec",
    up10: "/pay/checkout.php?produto=prod_698630ff20897",
    up11: "/pay/checkout.php?produto=prod_69863107b709d",
    up12: "/pay/checkout.php?produto=prod_698631105cc74",
    up13: "/pay/checkout.php?produto=prod_6986311823cf5",
    up14: "/pay/checkout.php?produto=prod_698631218da01",
    up15: "/pay/checkout.php?produto=prod_69863128c6fb7",
    up16: "/pay/checkout.php?produto=prod_6986313159696",
    up17: "/pay/checkout.php?produto=prod_6986313997fb8",
    up18: "/pay/checkout.php?produto=prod_69863146b1a52",
    up19: "/pay/checkout.php?produto=prod_6986313fbc20c",
    up20: "/pay/checkout.php?produto=prod_6986314e1cdab",
    back: "/pay/checkout.php?produto=prod_6986314e1cdab",
    whats: "https://www.pagamentos-seguro.link/checkout/58f94bc4-24c8-417b-b4ab-94ee52f24d15",
  };

  function resolveCheckoutUrl(path) {
    if (typeof window.credpixPath === "function") return window.credpixPath(path);
    var base = "";
    if (typeof window.credpixGetBasePath === "function") {
      base = window.credpixGetBasePath();
    } else {
      base = (window.CREDPIX_BASE_PATH || "").replace(/\/$/, "");
    }
    if (!base) {
      var m = location.pathname.match(/^(\/[^/]+)\/(?:up|pay|type|config|js)\//);
      if (m) base = m[1];
    }
    return base ? base + path : path;
  }

  function redirect(key) {
    const base = BASE_LINKS[key];
    if (!base) return;

    var target = resolveCheckoutUrl(base);
    if (window.credpixAppendUtms) target = window.credpixAppendUtms(target);
    if (window.CredPixAnalytics) {
      window.CredPixAnalytics.track("upsell_click", {
        funnel_step: "upsell",
        meta: { upsell_key: key },
      });
    }
    window.location.href = target;
  }

  window.redirect = redirect;

  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-credpix-checkout]") : null;
    if (!el) return;
    var key = el.getAttribute("data-credpix-checkout");
    if (key) redirect(key);
  });
})();
