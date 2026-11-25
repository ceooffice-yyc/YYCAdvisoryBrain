// The "Page not found" page (public/404.html): after 3 seconds it takes the person back to the first page, with a visible countdown and a "Stay on this page" button
// (people must be able to stop an automatic redirect). It is a separate file because the site's security policy does not allow inline scripts.
//   - open any unknown address with ?stay (e.g. /no-such-page?stay) to switch the redirect off: used by the automated tests and by anyone who wants to read the page;
//   - location.replace() is used, so the Back button does not return to this page and bounce the person forward again;
//   - without JavaScript, a <noscript> meta refresh in the page does the same after 3 seconds.
(function () {
  var SECONDS = 3;
  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), count = $('count'), num = $('num'), say = $('say'), bar = $('bar'), stay = $('stay'), go = $('go');
  if (!main || !count || !num || !say || !bar || !stay || !go) { try { location.replace('/'); } catch { /* the link on the page still works */ } return; }

  var show = function (el, on) { if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); };
  var stopped = false, left = SECONDS, timer = null;
  var words = function (n) { return 'Taking you back to the first page in ' + n + ' second' + (n === 1 ? '' : 's') + '…'; };

  // the visible text (#num) changes every second; screen readers hear one sentence only (#say), so they are not interrupted each second
  function stop(message) {
    stopped = true;
    if (timer) clearInterval(timer);
    main.classList.remove('running');
    show(bar, false); show(stay, false);
    num.textContent = message; say.textContent = message; show(count, true);
  }

  if (/(^|[?&])stay(=|&|$)/.test(location.search)) { stop('Automatic redirect is off.'); return; }

  num.textContent = words(left); say.textContent = words(left);
  show(count, true); show(bar, true); show(stay, true);

  timer = setInterval(function () {
    if (stopped) return;
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      try { location.replace('/'); } catch { window.location.href = "/"; }
      return;
    }
    num.textContent = words(left);
  }, 1000);

  stay.addEventListener('click', function () { stop('Automatic redirect cancelled. You can stay on this page.'); go.focus(); });
  go.addEventListener('click', function () { stopped = true; if (timer) clearInterval(timer); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !stopped) stop('Automatic redirect cancelled. You can stay on this page.'); });
})();
