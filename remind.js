/* Renewal reminder form(s): fills the year list, sends to /api/remind, shows the result.
   Also shows the status message on /reminders after confirm / unsubscribe links. */
(function () {
  var now = new Date();
  var thisYear = now.getFullYear();

  document.querySelectorAll('.remind-form').forEach(function (form) {
    var year = form.querySelector('select[id$="year"]');
    var month = form.querySelector('select[id$="month"]');
    for (var y = thisYear; y <= thisYear + 5; y++) {
      var o = document.createElement('option');
      o.value = o.textContent = String(y);
      year.appendChild(o);
    }
    var msg = form.querySelector('.form-msg');
    var btn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.className = 'form-msg';
      if (!month.value || !year.value) { msg.textContent = 'Please choose the month and year your licence expires.'; msg.className = 'form-msg err'; return; }
      form.querySelector('input[name="expiry"]').value = year.value + '-' + month.value;
      btn.disabled = true;
      msg.textContent = 'Sending…';
      fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Something went wrong. Please try again.' }; }); })
        .then(function (res) {
          msg.textContent = res.ok ? res.message : res.error;
          msg.className = 'form-msg ' + (res.ok ? 'ok' : 'err');
          if (res.ok) {
            var st = form.querySelector('select[name="state"]').value;
            form.reset();
            if (window.tlcTrack) window.tlcTrack('reminder_signup', { state: st, page: location.pathname });
          }
        })
        .catch(function () { msg.textContent = 'That didn’t send. Please check your connection and try again.'; msg.className = 'form-msg err'; })
        .then(function () { btn.disabled = false; });
    });
  });

  var notice = document.getElementById('statusNotice');
  var status = new URLSearchParams(location.search).get('status');
  var text = {
    confirmed: 'You’re all set. We’ll email you 3 months and 1 month before your licence expires.',
    unsubscribed: 'You’re unsubscribed and your details have been deleted.',
    expired: 'That confirmation link has expired. Please fill in the form again.',
    invalid: 'That link didn’t work. Please fill in the form again, or contact us.'
  }[status];
  if (notice && text) {
    notice.textContent = text;
    notice.className = 'notice ' + (status === 'confirmed' || status === 'unsubscribed' ? 'ok' : 'err');
    notice.hidden = false;
    if (status === 'confirmed' && window.tlcTrack) window.tlcTrack('reminder_confirmed', {});
  }
})();
