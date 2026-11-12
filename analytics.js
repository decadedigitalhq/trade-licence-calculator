/* Trade Licence Calculator AU — analytics
   Loads Google Analytics 4 only when GA_ID is set (Shaun creates the property, Dex adds the ID).
   Events: calculate (state, trade, option, term), affiliate_click (partner, page), regulator_click (host, page).
   No personal data is sent. */
(function () {
  var GA_ID = 'G-QKPGXSH0PH';

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  if (GA_ID) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_ID);
  }

  window.tlcTrack = function (name, params) {
    if (GA_ID) gtag('event', name, params || {});
  };

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="http"]') : null;
    if (!a) return;
    var page = location.pathname;
    if ((a.getAttribute('rel') || '').indexOf('sponsored') !== -1) {
      var partner = /bizcover/i.test(a.href) ? 'bizcover' : /tradify/i.test(a.href) ? 'tradify' : a.hostname;
      window.tlcTrack('affiliate_click', { partner: partner, page: page });
    } else if (/\.gov\.au$/i.test(a.hostname)) {
      window.tlcTrack('regulator_click', { host: a.hostname, page: page });
    }
  });
})();
