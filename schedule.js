// De Club — weekly schedule section (shared: homepage + pricing page)
//
// Fetches the class schedule (synced hourly from Arbox into Supabase by the
// public-schedule Trigger.dev task) and renders one week at a time (Sun–Fri,
// no Saturday) for a single chosen floor (VUCA / ART / LIVO). Week navigation
// spans 2 weeks back to 2 weeks forward. Session name, teacher, and hours only
// — no signups, counts, or booking.

(function () {
  'use strict';

  var grid = document.getElementById('scheduleGrid');
  if (!grid) return;

  var floorsWrap = document.getElementById('scheduleFloors');
  var weekLabel = document.getElementById('schedWeekLabel');
  var prevBtn = document.getElementById('schedPrev');
  var nextBtn = document.getElementById('schedNext');

  var ENDPOINT = '/.netlify/functions/schedule';
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = { data: null, floor: 'VUCA', offset: 0, back: 2, fwd: 2, sunday: null };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }

  function currentSunday() { return addDays(state.sunday, state.offset * 7); }

  function fmtRange(sun, fri) {
    var sM = MONTHS[sun.getUTCMonth()], fM = MONTHS[fri.getUTCMonth()];
    if (sM === fM) return sun.getUTCDate() + '–' + fri.getUTCDate() + ' ' + fM;
    return sun.getUTCDate() + ' ' + sM + ' – ' + fri.getUTCDate() + ' ' + fM;
  }

  function render() {
    if (floorsWrap) {
      Array.prototype.forEach.call(floorsWrap.querySelectorAll('[data-floor]'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-floor') === state.floor);
      });
    }

    var sun = currentSunday();
    var fri = addDays(sun, 5);
    if (weekLabel) weekLabel.textContent = fmtRange(sun, fri);
    if (prevBtn) prevBtn.disabled = state.offset <= -state.back;
    if (nextBtn) nextBtn.disabled = state.offset >= state.fwd;

    var days = state.data && state.data.days ? state.data.days : {};
    grid.innerHTML = '';

    // Sun (0) through Fri (5) — six columns, never Saturday.
    for (var i = 0; i < 6; i++) {
      var dayDate = addDays(sun, i);
      var key = ymd(dayDate);
      var col = el('div', 'schedule-day');

      var head = el('div', 'schedule-day-head');
      head.appendChild(el('span', 'schedule-day-name', DAY_NAMES[dayDate.getUTCDay()]));
      head.appendChild(el('span', 'schedule-day-date', dayDate.getUTCDate() + '.' + (dayDate.getUTCMonth() + 1)));
      col.appendChild(head);

      var sessions = (days[key] || [])
        .filter(function (s) { return (s.floor || '').toUpperCase() === state.floor; })
        .sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });

      if (!sessions.length) {
        col.appendChild(el('div', 'schedule-rest', '—'));
      } else {
        sessions.forEach(function (s) {
          var card = el('div', 'schedule-card');
          card.setAttribute('data-floor', state.floor);
          var timeRow = el('div', 'schedule-time');
          timeRow.appendChild(el('span', null, s.start + (s.end ? '–' + s.end : '')));
          card.appendChild(timeRow);
          card.appendChild(el('div', 'schedule-name', s.session_name || 'Session'));
          if (s.teacher) card.appendChild(el('div', 'schedule-teacher', s.teacher));
          col.appendChild(card);
        });
      }
      grid.appendChild(col);
    }
  }

  function wire() {
    if (floorsWrap) {
      floorsWrap.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-floor]') : null;
        if (!b) return;
        state.floor = b.getAttribute('data-floor');
        render();
      });
    }
    if (prevBtn) prevBtn.addEventListener('click', function () {
      if (state.offset > -state.back) { state.offset--; render(); }
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      if (state.offset < state.fwd) { state.offset++; render(); }
    });
  }

  fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (d) {
      state.data = d;
      if (typeof d.weeks_back === 'number') state.back = d.weeks_back;
      if (typeof d.weeks_forward === 'number') state.fwd = d.weeks_forward;
      if (d.current_week_start) {
        state.sunday = parseDate(d.current_week_start);
      } else {
        // Fallback: this week's Sunday from the client clock.
        var now = new Date();
        var t = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        state.sunday = addDays(t, -t.getUTCDay());
      }
      wire();
      render();
    })
    .catch(function () {
      grid.innerHTML = '';
      grid.appendChild(el('p', 'schedule-empty', 'Schedule unavailable right now.'));
    });
})();
