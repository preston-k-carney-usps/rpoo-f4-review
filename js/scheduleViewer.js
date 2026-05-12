// scheduleViewer.js — Read-only schedule cards for all review roles (PODs, MH, etc.)
(function() {
  'use strict';

  var viewSelect = document.getElementById('sched-view-type');
  var viewCard = document.getElementById('sched-view-card');
  if (!viewSelect || !viewCard) return;

  function render() {
    if (!window.ScheduleCards) {
      viewCard.innerHTML = '<p class="empty-state">No schedule has been built yet.</p>';
      return;
    }

    var type = viewSelect.value;
    var html = '';
    if (type === 'trips') {
      html = window.ScheduleCards.tripsCard();
    } else if (type === 'airport') {
      html = window.ScheduleCards.airportCard();
    } else {
      html = window.ScheduleCards.reviewCard();
    }

    viewCard.innerHTML = html || '<p class="empty-state">No data available for this view.</p>';
  }

  viewSelect.addEventListener('change', render);

  // Render when the Schedules tab is activated
  document.querySelectorAll('.review-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      if (tab.dataset.tab === 'tab-schedules') render();
    });
  });
})();
