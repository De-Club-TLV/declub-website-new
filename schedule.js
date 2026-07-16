// De Club — weekly schedule section (shared: homepage + pricing page)
//
// Fetches the minimal class schedule (synced hourly from Arbox into Supabase
// by the public-schedule Trigger.dev task) and renders a weekly grid:
// day columns, each a time-sorted stack of session cards (time · name · teacher).
// Floors: VUCA / ART / LIVO only. No signups, counts, or booking.

(function () {
  'use strict';

  var grid = document.getElementById('scheduleGrid');
  if (!grid) return;

  var ENDPOINT = '/.netlify/functions/schedule';
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // "2026-07-17" -> {weekday:"Thu", label:"17.7"} in a TZ-safe way (parse parts).
  function fmtDay(dateStr) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return { weekday: DAY_NAMES[d.getUTCDay()], label: (+p[2]) + '.' + (+p[1]) };
  }

  function render(payload) {
    grid.innerHTML = '';
    var days = payload && payload.days ? payload.days : {};
    var dates = Object.keys(days).sort();
    if (!dates.length) {
      grid.appendChild(el('p', 'schedule-empty', 'Schedule updating. Check back shortly.'));
      return;
    }

    dates.forEach(function (date) {
      var col = el('div', 'schedule-day');
      var head = el('div', 'schedule-day-head');
      var f = fmtDay(date);
      head.appendChild(el('span', 'schedule-day-name', f.weekday));
      head.appendChild(el('span', 'schedule-day-date', f.label));
      col.appendChild(head);

      var sessions = (days[date] || []).slice().sort(function (a, b) {
        return (a.start || '').localeCompare(b.start || '');
      });

      if (!sessions.length) {
        col.appendChild(el('div', 'schedule-rest', 'Rest day'));
      } else {
        sessions.forEach(function (s) {
          var card = el('div', 'schedule-card');
          var floor = (s.floor || '').toUpperCase();
          card.setAttribute('data-floor', floor);

          var timeRow = el('div', 'schedule-time');
          timeRow.appendChild(el('span', null, s.start + (s.end ? '–' + s.end : '')));
          if (floor) timeRow.appendChild(el('span', 'schedule-chip', floor));
          card.appendChild(timeRow);

          card.appendChild(el('div', 'schedule-name', s.session_name || 'Session'));
          if (s.teacher) card.appendChild(el('div', 'schedule-teacher', s.teacher));
          col.appendChild(card);
        });
      }
      grid.appendChild(col);
    });
  }

  fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(render)
    .catch(function () {
      grid.innerHTML = '';
      grid.appendChild(el('p', 'schedule-empty', 'Schedule unavailable right now.'));
    });
})();
