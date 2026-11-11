// Vroeg geladen (in <head>) zodat er geen witte flits is in de donkere modus.
(function () {
  var root = document.documentElement;
  var pref = 'systeem';
  try { pref = localStorage.getItem('theme') || 'systeem'; } catch (e) {}
  var dark = pref === 'donker' || (pref === 'systeem' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'donker' : 'licht');

  // In de Android-app: ruimte van status- en navigatiebalk, en de kleur van die balken.
  var native = window.NotitiesNative;
  if (native) {
    root.classList.add('native');
    try {
      var i = native.insets().split(',');
      root.style.setProperty('--sat', i[0] + 'px');
      root.style.setProperty('--sab', i[1] + 'px');
      native.setDark(dark);
    } catch (e) {}
    // Glisse (Liquid Glass met echte breking) voor navigatie en schuifknoppen, als het toestel het aankan.
    // app.js laadt het en haalt de klasse weg als het niet lukt; dan blijft de gewone navigatie.
    try {
      if (/Chrom(?:e|ium)\//.test(navigator.userAgent) && !localStorage.getItem('glisse-uit')) root.classList.add('glisse');
    } catch (e) {}
  }
})();
