/* MatterFlow Outlook drag-and-drop spike. No dependencies. Logs everything; stores/uploads nothing. */
(function () {
  'use strict';
  var events = [];
  var MAX_TEXT = 200000; // cap per string in the report
  var PROBE = ['text/plain', 'text/html', 'text/uri-list', 'text/rtf', 'message/rfc822', 'text', 'url', 'URL',
    'application/vnd.ms-outlook', 'text/x-moz-url', 'DownloadURL'];
  var $ = function (id) { return document.getElementById(id); };

  function cap(s) {
    if (s == null) return s;
    return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n...[truncated, original length ' + s.length + ']' : s;
  }
  function render() { $('log').textContent = events.length ? JSON.stringify(events, null, 2) : '(no events yet)'; }
  function status(t) { $('status').textContent = t; }
  function arr(x) { return Array.prototype.slice.call(x || []); }

  function describeItems(dt) {
    return arr(dt.items).map(function (it, i) { return { index: i, kind: it.kind, type: it.type }; });
  }
  function describeFiles(dt) {
    return arr(dt.files).map(function (f, i) {
      return { index: i, name: f.name, type: f.type, size: f.size, lastModified: f.lastModified };
    });
  }

  // Synchronous getData for every listed type plus well-known probes. Must run inside the event handler.
  function readData(dt) {
    var data = {}, listed = arr(dt.types), types = listed.slice();
    PROBE.forEach(function (t) { if (types.indexOf(t) < 0) types.push(t); });
    types.forEach(function (t) {
      try {
        var v = dt.getData(t);
        data[t] = { listed: listed.indexOf(t) >= 0, length: v.length, value: cap(v) };
      } catch (e) { data[t] = { error: String(e) }; }
    });
    return data;
  }

  function headBytes(f) {
    return f.slice(0, 16).arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf);
      var hex = arr(b).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(' ');
      var txt = String.fromCharCode.apply(null, b);
      var guess = hex.indexOf('d0 cf 11 e0 a1 b1 1a e1') === 0 ? 'OLE compound (.msg likely)'
        : /^(from|received|date|subject|mime|return-path|message-id|x-)/i.test(txt) ? 'RFC822 text (.eml likely)' : 'unknown';
      return { name: f.name, size: f.size, headHex: hex, guess: guess };
    }).catch(function (e) { return { name: f.name, error: String(e) }; });
  }

  // Async part: getAsString for string items, first bytes of file items. Items are captured synchronously.
  function readItemsAsync(dt, rec) {
    var list = arr(dt.items), pending = [];
    list.forEach(function (it, i) {
      if (it.kind === 'string') {
        pending.push(new Promise(function (res) {
          try { it.getAsString(function (s) { rec.itemStrings.push({ index: i, type: it.type, length: s.length, value: cap(s) }); res(); }); }
          catch (e) { rec.itemStrings.push({ index: i, type: it.type, error: String(e) }); res(); }
        }));
      } else if (it.kind === 'file') {
        var f = null; try { f = it.getAsFile(); } catch (e) { /* ignore */ }
        if (f) pending.push(headBytes(f).then(function (h) { rec.fileHeads.push(h); }));
      }
    });
    return Promise.all(pending);
  }

  function targetName(e) { var t = e.target; return t && t.id ? '#' + t.id : (t && t.tagName) || '?'; }
  function base(kind, e) {
    return {
      event: kind, atUtc: new Date().toISOString(), target: targetName(e),
      environment: $('env').value, scenario: $('scn').value,
      userAgent: navigator.userAgent, platform: navigator.platform,
      itemStrings: [], fileHeads: []
    };
  }
  function fill(rec, dt) {
    rec.types = arr(dt.types);
    rec.items = describeItems(dt);
    rec.files = describeFiles(dt);
    rec.getData = readData(dt);
    rec.hasEmlOrMsgFile = rec.files.some(function (f) { return /\.(eml|msg)$/i.test(f.name) || /rfc822|ms-outlook/i.test(f.type); });
  }

  var zone = $('zone'), dragLogged = false;

  document.addEventListener('dragenter', function (e) {
    e.preventDefault(); zone.classList.add('over');
    if (!dragLogged) { // contents are protected until drop; types and items kinds are visible
      dragLogged = true;
      var rec = base('dragenter', e);
      rec.types = arr(e.dataTransfer.types);
      rec.items = describeItems(e.dataTransfer);
      events.push(rec); render();
    }
  });
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) { zone.classList.remove('over'); dragLogged = false; }
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); zone.classList.remove('over'); dragLogged = false;
    var dt = e.dataTransfer, rec = base('drop', e);
    rec.dropEffect = dt.dropEffect; rec.effectAllowed = dt.effectAllowed;
    fill(rec, dt);
    events.push(rec); render();
    readItemsAsync(dt, rec).then(function () {
      render(); status('Drop logged: ' + rec.types.length + ' types, ' + rec.files.length + ' files.');
    });
  });
  document.addEventListener('paste', function (e) {
    var cd = e.clipboardData, rec = base('paste', e);
    if (!cd) { rec.error = 'no clipboardData'; events.push(rec); render(); return; }
    fill(rec, cd);
    rec.clipboardHtml = rec.getData['text/html'] ? rec.getData['text/html'].value : null;
    events.push(rec); render();
    readItemsAsync(cd, rec).then(function () { render(); status('Paste logged.'); });
  });

  function report() {
    return JSON.stringify({ tool: 'matterflow-outlook-dnd-spike', version: 1, generatedUtc: new Date().toISOString(), events: events }, null, 2);
  }
  $('copy').addEventListener('click', function () {
    var text = report();
    function done() { status('Report copied. Review it for confidential content before sending.'); }
    function fallback() {
      $('log').textContent = text;
      var r = document.createRange(); r.selectNodeContents($('log'));
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand('copy'); done(); } catch (err) { status('Copy failed: select the log text and copy manually.'); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  });
  $('dl').addEventListener('click', function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([report()], { type: 'application/json' }));
    a.download = 'outlook-dnd-report.json'; a.click();
  });
  $('clear').addEventListener('click', function () { events = []; render(); status('Cleared.'); });
  render();
})();
