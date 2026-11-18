/* Notes round 2 mockup (#1406, epic #1405): Matter > Notes with folders, images in notes and formatted paste. Tiny renderer, no framework, no network, nothing saves, no app code.
   URL options (all optional; combine with &):
     ?scene=main|new-folder|rename|move-folder|move-note|delete|delete-empty|drag|empty-folder|empty-tree|image|image-details|image-read|image-fail|paste|plain|locked
     ?err=dup|empty|long        New Folder and Rename Folder: show a validation message
     ?reason=size|type|count|offline|access|locked     image-fail: why the image could not be added
     ?rail=1                    the folder tree folded to its 44 px rail
     ?chrome=0 hides the mockup guide, ?guide=1 opens it. */
(function () {
  const D = window.D;
  const Q = new URLSearchParams(location.search);
  const $root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ic = (n, c) => '<i class="pi pi-' + n + (c ? ' ' + c : '') + '" aria-hidden="true"></i>';
  if (Q.get('chrome') === '0') document.body.classList.add('nochrome');

  const SCENES = [
    ['main', 'Folders, list and a note (main screen)'], ['new-folder', 'New Folder dialog (with the duplicate-name error)'], ['rename', 'Rename Folder dialog'],
    ['move-folder', 'Move Folder dialog (disabled targets)'], ['move-note', 'Move Note dialog'], ['delete', 'Delete Folder, folder with contents'], ['delete-empty', 'Delete Folder, empty folder'],
    ['drag', 'Dragging a note onto a folder'], ['empty-folder', 'Empty folder'], ['empty-tree', 'Matter with no folders yet'], ['locked', 'A locked note in a folder'],
    ['image', 'Image in a note: resize handles and size readout'], ['image-details', 'Image Details dialog (alt text, exact width)'], ['image-read', 'Image in read mode'],
    ['image-fail', 'Paste image: uploading and failed'], ['paste', 'Formatted paste: Word, today, round 2'], ['plain', 'Paste Options: Paste as Plain Text'],
  ];
  const S = {
    scene: Q.get('scene') || 'main', sel: 5, exp: { 1: 1, 4: 1 }, note: 'Custodian interview: R. Alvarez (CFO)', menu: null, dlg: null, toast: null, guide: Q.get('guide') === '1',
    rail: Q.get('rail') === '1', fold: false, err: Q.get('err') || '', reason: Q.get('reason') || 'size',
  };
  const F = D.FOLDERS.map(([id, parent, name]) => ({ id, parent, name }));
  const byId = (id) => F.find((f) => f.id === id);
  const kids = (p) => F.filter((f) => f.parent === p).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const pathOf = (id) => { const out = []; let f = byId(id); while (f) { out.unshift(f); f = byId(f.parent); } return out; };
  const direct = (id) => D.NOTES.filter((n) => n.folder === id).length;
  const depthOf = (id) => pathOf(id).length;

  /* ---------- scene setup ---------- */
  function setup() {
    const s = S.scene;
    if (s === 'main' || s === 'locked') { S.sel = 5; S.exp = { 1: 1, 4: 1 }; }
    if (s === 'locked') { S.sel = 6; S.note = 'Finance share drive: retention schedule'; }
    if (s === 'new-folder' || s === 'rename' || s === 'move-folder' || s === 'move-note' || s === 'delete' || s === 'delete-empty') { S.sel = 5; S.exp = { 1: 1, 4: 1, 13: 1 }; }
    if (s === 'delete') { S.sel = 10; S.exp = { 1: 1, 4: 1, 8: 1 }; }
    if (s === 'delete-empty') { S.sel = 15; S.exp = { 1: 1, 13: 1 }; }
    if (s === 'drag') { S.sel = 5; S.exp = { 1: 1, 4: 1 }; }
    if (s === 'empty-folder') { S.sel = 15; S.exp = { 4: 1, 13: 1 }; S.note = null; }
    if (s === 'empty-tree') { S.sel = 'all'; S.note = null; F.length = 0; D.NOTES = D.NOTES.filter((n) => n.folder === 0); }
    if (['image', 'image-details', 'image-read', 'image-fail', 'plain'].includes(s)) { S.sel = 2; S.exp = { 1: 1 }; S.note = 'Log batch 3: 214 entries, 9 open questions'; S.rail = true; S.fold = true; }
    if (Q.get('rail') === '0') S.rail = false;
    if (s === 'move-note') { S.sel = 5; }
  }

  /* ---------- frame ---------- */
  const NAV = [['chart-bar', 'Dashboard'], ['briefcase', 'My Matters'], ['list-check', 'My Work'], ['building', 'Clients'], ['folder', 'Matters'], ['address-book', 'People'], ['users', 'Pod Work'], ['list', 'Task Queue']];
  const nav = () => '<nav class="nav" aria-label="Main"><div class="logo"><i>LH</i>LPT Hub</div>' + NAV.map(([i, l]) => '<a href="#" ' + (l === 'Matters' ? 'aria-current="page"' : '') + '>' + ic(i) + l + '</a>').join('') + '</nav>';
  const top = () => '<header class="top"><div class="gs">' + ic('search') + 'Search clients, matters, tasks, assets...<kbd>Ctrl+K</kbd></div><span class="sp"></span><button class="btn btn--icon" aria-label="Notifications">' + ic('bell') + '</button><span class="avatar" title="Priya Raman">PR</span></header>';
  const TABS = [['th-large', 'Summary'], ['check-square', 'Tasks'], ['sitemap', 'Projects'], ['database', 'Assets'], ['box', 'Productions'], ['file-edit', 'Notes', 'N'], ['users', 'Team']];
  function frame(card, extra) {
    return '<div class="app">' + nav() + top() + '<main class="main"><div class="page">' +
      (S.fold ? '<h1 class="sr">' + D.matter.name + '</h1>' : '<div class="crumb"><a href="#">Matters</a><span>/</span><a href="#">Hartwell Industries</a><span>/</span><span class="cur">' + D.matter.cm + '</span></div>' +
      '<div class="mh"><span class="tile">' + ic('folder') + '</span><div><h1>' + D.matter.name + '</h1><div class="cm">CM Number <span class="mono">' + D.matter.cm + '</span> &middot; ' + D.matter.client + '</div></div><span class="sp"></span><button class="btn">' + ic('pencil') + 'Edit Matter</button></div>') +
      '<div class="tabs" role="tablist">' + TABS.map(([i, l, n]) => '<button class="tab" role="tab" aria-selected="' + (l === 'Notes') + '">' + ic(i) + l + (n ? ' <span class="cnt">' + D.NOTES.length + '</span>' : '') + '</button>').join('') + '</div>' +
      card + '</div></main>' + (extra || '') + '</div>';
  }

  /* ---------- folder tree ---------- */
  const TREE_ICON = { all: 'list', none: 'file' };
  function row(lvl, o) {
    const sel = S.sel === o.key;
    return '<div class="tr' + (o.cls ? ' ' + o.cls : '') + '" role="treeitem" aria-level="' + (lvl + 1) + '"' + (o.exp != null ? ' aria-expanded="' + o.exp + '"' : '') + ' aria-selected="' + sel + '"' + (o.dis ? ' aria-disabled="true"' : '') + ' style="--lvl:' + lvl + '"' + (o.id ? ' data-f="' + o.id + '"' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' +
      '<button class="chev' + (o.exp == null ? ' none' : '') + '" tabindex="-1" aria-label="' + (o.exp ? 'Collapse' : 'Expand') + ' ' + esc(o.name) + '">' + (o.exp != null ? ic(o.exp ? 'chevron-down' : 'chevron-right') : '') + '</button>' +
      ic(o.icon, 'fi') + '<span class="nm">' + esc(o.name) + '</span>' + (o.n != null ? '<span class="n">' + o.n + '</span>' : '') +
      (o.more ? '<button class="more" tabindex="-1" aria-label="Actions for ' + esc(o.name) + '" aria-haspopup="menu">' + ic('ellipsis-h') + '</button>' : '') + '</div>';
  }
  function folderRows(parent, lvl, opts) {
    return kids(parent).map((f) => {
      const hasKids = kids(f.id).length > 0;
      const open = !!S.exp[f.id];
      const o = Object.assign({ key: f.id, id: f.id, name: f.name, icon: open && hasKids ? 'folder-open' : 'folder', n: direct(f.id), more: !opts.pick, exp: hasKids ? open : null }, opts.row ? opts.row(f) : {});
      return row(lvl, o) + (hasKids && open ? folderRows(f.id, lvl + 1, opts) : '');
    }).join('');
  }
  function tree() {
    if (S.rail) {
      return '<aside class="nt__tree" style="width:44px" aria-label="Folders, folded"><div class="nt__tree-h" style="padding:0;justify-content:center;height:48px"><button class="ibtn" aria-label="Show Folders" title="Show Folders">' + ic('angle-double-right') + '</button></div>' +
        '<div style="display:grid;justify-items:center;gap:4px;padding-top:4px"><button class="ibtn" aria-label="All Notes" title="All Notes">' + ic('list') + '</button><button class="ibtn" aria-label="Folder: Privilege Review, Privilege Log" title="Privilege Review > Privilege Log" style="background:var(--mf-selected-bg);color:var(--mf-primary)">' + ic('folder-open') + '</button></div></aside>';
    }
    const none = F.length === 0;
    const rows = row(0, { key: 'all', name: 'All Notes', icon: 'list', n: D.NOTES.length, cls: 'root-row' }) +
      (none ? '' : row(0, { key: 'none', name: 'No Folder', icon: 'file', n: D.NOTES.filter((n) => n.folder === 0).length, cls: 'root-row', title: 'Notes that are not in a folder' })) +
      '<div class="tree-sep"></div>' + (none ? '<div class="tree-note"><span>No folders yet.</span><button class="btn btn--text">' + ic('folder-plus') + 'New Folder</button></div>' : folderRows(0, 0, {}));
    let menu = '';
    if (S.menu === 'folder') {
      menu = '<div class="fmenu" role="menu" aria-label="Actions for Executive Team" style="left:108px;top:312px">' +
        '<button role="menuitem">' + ic('folder-plus') + 'New Subfolder</button><button role="menuitem">' + ic('pencil') + 'Rename</button><button role="menuitem">' + ic('arrow-right-arrow-left') + 'Move to Folder...</button><button role="menuitem">' + ic('link') + 'Copy Link</button><hr><button role="menuitem" class="dng">' + ic('trash') + 'Delete Folder</button></div>';
    }
    return '<aside class="nt__tree" aria-label="Folders" style="position:relative"><div class="nt__tree-h"><h2>Folders</h2><button class="ibtn ibtn--sm" aria-label="New Folder" title="New Folder">' + ic('folder-plus') + '</button><button class="ibtn ibtn--sm" aria-label="Hide Folders" title="Hide Folders">' + ic('angle-double-left') + '</button></div>' +
      '<div class="nt__tree-b"><div class="tree" role="tree" aria-label="Note folders">' + rows + '</div></div>' + menu + '</aside>';
  }

  /* ---------- list ---------- */
  const tg = (k) => '<span class="tg tg--' + D.TAGS[k].tone + '"><i></i>' + D.TAGS[k].name + '</span>';
  const AVC = { PR: '', DO: 'a1', ML: 'a2', TB: 'a3', HF: 'a4' };
  function notesIn() {
    if (S.sel === 'all') return D.NOTES;
    if (S.sel === 'none') return D.NOTES.filter((n) => n.folder === 0);
    return D.NOTES.filter((n) => n.folder === S.sel);
  }
  function crumbs() {
    if (S.sel === 'all') return '<span>All Notes</span>';
    if (S.sel === 'none') return '<span>No Folder</span>';
    const p = pathOf(S.sel);
    return p.map((f, i) => (i === p.length - 1 ? '<span>' + esc(f.name) + '</span>' : '<a href="#">' + esc(f.name) + '</a>')).join('<span class="sepi">' + ic('angle-right') + '</span>');
  }
  function list() {
    const ns = notesIn().slice().sort((a, b) => (b.p - a.p));
    const heading = S.sel === 'all' ? 'All Notes' : S.sel === 'none' ? 'No Folder' : pathOf(S.sel).map((f) => f.name).join(' > ');
    let body;
    if (ns.length === 0) {
      body = '<div class="state-wrap"><div class="state">' + ic('folder-open') + '<p>No notes in this folder yet.</p><small>Notes you add or move here show up in this list.</small><button class="btn btn--primary">' + ic('plus') + 'New Note</button></div></div>';
    } else {
      body = '<div class="nt__scroll"><ul class="nl" aria-label="Notes in ' + esc(heading) + '">' + ns.map((n) => {
        const cur = n.title === S.note;
        return '<li class="row' + (cur ? '" aria-current="true' : '') + (S.scene === 'drag' && n.title === 'M. Chen mobile device collection status' ? ' dragging' : '') + '"><span class="av ' + AVC[n.by] + '" aria-hidden="true">' + n.by + '</span><div style="min-width:0"><div class="tt">' + (n.p ? ic('thumbtack') : '') + (n.l ? ic('lock') : '') + '<span class="t">' + esc(n.title) + '</span></div>' +
          '<div class="pv">' + esc(n.pv) + '</div><div class="tags">' + (n.tags.length ? n.tags.map(tg).join('') : '<span class="muted xs">No tags</span>') + '</div><div class="meta">Updated by <b>' + D.people[n.by] + '</b> &middot; ' + n.at + '</div></div></li>';
      }).join('') + '</ul></div>';
    }
    return '<section class="nt__list" aria-label="Note list" data-notes-list><div class="nt__lc"><div class="nt__lc1"><div class="search">' + ic('search') + '<input placeholder="Search title and text" aria-label="Search notes by title and text"></div><button class="btn btn--primary">' + ic('plus') + 'New Note</button><button class="ibtn" aria-pressed="' + S.fold + '"' + (S.fold ? ' style="background:var(--mf-selected-bg);color:var(--mf-primary)"' : '') + ' aria-label="' + (S.fold ? 'Show the matter header again' : 'Expand to the full height') + '" title="' + (S.fold ? 'Show the matter header again' : 'Expand to the full height') + '">' + ic('arrows-v') + '</button></div>' +
      '<div class="nt__lc2"><div class="seg" role="group" aria-label="Notes view"><button aria-pressed="false">By Tag</button><button aria-pressed="true">Latest</button><button aria-pressed="false">Templates</button></div><button class="btn">' + ic('sliders-h') + 'View Options</button></div></div>' +
      '<div class="nt__path"><span class="pathline">' + ic(S.sel === 'all' ? 'list' : S.sel === 'none' ? 'file' : 'folder-open') + '</span><div class="crumbs">' + crumbs() + '</div><span class="cnt" aria-label="Notes in this folder">' + ns.length + '</span></div>' + body + '</section>';
  }

  /* ---------- note panel ---------- */
  function where(id) {
    const p = pathOf(id);
    return '<button class="where" title="Show this folder in the list">' + ic('folder') + p.map((f) => esc(f.name)).join('<span class="sepi">' + ic('angle-right') + '</span>') + '</button>';
  }
  function readDoc() {
    return '<div class="doc"><h1>Custodian interview: R. Alvarez (CFO)</h1><p>Interview held 11/16 by phone, 55 minutes. Present: Priya Raman, Daniel Okafor, and Hartwell in-house counsel.</p>' +
      '<h2>Sources named</h2><ul><li>Company laptop and a personal tablet used for board materials</li><li>Texts with the CEO are on the company phone</li><li>Two shared drives: Finance Reporting and Board Archive</li></ul>' +
      '<table><thead><tr><th>Source</th><th>Hold</th><th>Owner</th></tr></thead><tbody><tr><td>Finance Reporting drive</td><td>10/30</td><td>T. Berg</td></tr><tr><td>Board Archive drive</td><td>10/30</td><td>T. Berg</td></tr><tr><td>Personal tablet</td><td>Pending</td><td>D. Okafor</td></tr></tbody></table>' +
      '<p>Follow up on the tablet before the second hold notice goes out.</p></div>';
  }
  function notePanel() {
    if (!S.note) return '<section class="nt__note"><div class="state-wrap"><div class="state">' + ic('file') + '<p>Select a note to read it.</p><small>The note opens here. People who can edit the matter see an Edit button.</small></div></div></section>';
    const locked = S.scene === 'locked';
    const n = D.NOTES.find((x) => x.title === S.note) || D.NOTES[0];
    const fld = n.folder;
    return '<section class="nt__note" aria-label="Note"><div class="np-h">' + (fld ? where(fld) : '<span class="muted">No Folder</span>') + '<span class="sp"></span>' +
      (locked ? '<span class="chip chip--risk">' + ic('lock') + 'Locked by Tomas Berg</span>' : '') +
      '<button class="btn"' + (locked ? ' disabled' : '') + '>' + ic('pencil') + 'Edit</button><button class="ibtn" aria-label="History" title="History">' + ic('history') + '</button><button class="ibtn" aria-label="More actions" title="More actions">' + ic('ellipsis-h') + '</button></div>' +
      '<div class="np-b"><div class="np-meta">' + n.tags.map(tg).join('') + '<span>Updated by <b>' + D.people[n.by] + '</b> &middot; ' + n.at + '</span></div>' +
      (n.title.startsWith('Custodian interview') ? readDoc() : '<div class="doc"><h1>' + esc(n.title) + '</h1><p>' + esc(n.pv) + '</p></div>') + '</div></section>';
  }
  const card = (inner, cls) => '<section class="nt ' + (cls || '') + '" aria-label="Notes" data-notes-tab>' + inner + '</section>';

  /* ---------- dialogs ---------- */
  function dialog(title, sub, body, foot, size) {
    return '<div class="scrim"><div class="dlg dlg--' + (size || 'md') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><div class="dlg-h"><div><h2 id="dlg-t">' + title + '</h2>' + (sub ? '<p class="muted sm">' + sub + '</p>' : '') + '</div><button class="btn btn--icon" aria-label="Close">' + ic('times') + '</button></div><div class="dlg-b">' + body + '</div><div class="dlg-f">' + foot + '</div></div></div>';
  }
  function nameDialog(kind) {
    const rename = kind === 'rename';
    const val = S.err === 'dup' ? 'Finance' : S.err === 'long' ? 'Search terms and validation samples for the second round of the negotiated list' : S.err === 'empty' ? '' : rename ? 'Finance' : 'Bank Records';
    const msg = S.err === 'dup' ? (rename ? 'A folder named "IT and Records" already exists in Custodians.' : 'A folder named "Finance" already exists in Custodians.') : S.err === 'long' ? 'Use 100 characters or fewer.' : S.err === 'empty' ? 'Enter a folder name.' : '';
    const v2 = S.err === 'dup' && rename ? 'IT and Records' : val;
    return dialog(rename ? 'Rename Folder' : 'New Folder', rename ? 'Custodians' : '',
      '<div class="fld"><label class="lbl" for="fn">Folder Name <span class="req">*</span></label><input id="fn" class="inp' + (msg ? ' inp--err' : '') + '" value="' + esc(v2) + '" aria-invalid="' + !!msg + '" aria-describedby="fh">' +
      (msg ? '<p class="err" id="fh">' + ic('exclamation-circle') + msg + '</p>' : '<p class="help" id="fh">' + (rename ? 'Names are unique inside the same parent folder.' : 'Created in <b>Custodians</b>. Use New Subfolder on another folder to create it there.') + '</p>') + '</div>',
      '<span class="sp"></span><button class="btn">Cancel</button><button class="btn btn--primary"' + (msg ? ' disabled' : '') + '>' + (rename ? 'Save Changes' : 'Create Folder') + '</button>');
  }
  /* A picker row for Move: radio dot, folder icon, name, reason on the right when disabled. */
  function pickRows(parent, lvl, movingId, cur) {
    return kids(parent).map((f) => {
      const inside = movingId && pathOf(f.id).some((x) => x.id === movingId);
      const tooDeep = movingId && !inside && depthOf(f.id) + subtreeHeight(movingId) > 5;
      const dis = inside || tooDeep;
      const why = inside ? (f.id === movingId ? 'This folder' : 'Inside it') : tooDeep ? 'Too deep' : '';
      const title = inside ? 'A folder cannot move into itself or its subfolders.' : tooDeep ? 'It would be more than 5 levels deep.' : '';
      return '<div class="tr' + (dis ? '" aria-disabled="true' : '') + '" role="treeitem" aria-level="' + (lvl + 2) + '" aria-selected="' + (cur === f.id) + '" style="--lvl:' + (lvl + 1) + '"' + (title ? ' title="' + title + '"' : '') + '><span class="rd"></span>' + ic(kids(f.id).length ? 'folder-open' : 'folder', 'fi') + '<span class="nm">' + esc(f.name) + '</span>' + (why ? '<span class="why">' + why + '</span>' : '') + '</div>' + pickRows(f.id, lvl + 1, movingId, cur);
    }).join('');
  }
  function subtreeHeight(id) { const k = kids(id); return 1 + (k.length ? Math.max.apply(null, k.map((c) => subtreeHeight(c.id))) : 0); }
  function moveDialog(kind) {
    const folder = kind === 'folder';
    const body = '<div class="fld"><span class="lbl" id="mt">Move To</span><div class="pick" role="tree" aria-labelledby="mt"><div class="tr" role="treeitem" aria-level="1" aria-selected="false"><span class="rd"></span>' + ic('file', 'fi') + '<span class="nm">' + (folder ? 'Top level (no parent)' : 'No Folder') + '</span></div>' +
      pickRows(0, 0, folder ? 4 : null, folder ? 1 : 3) + '</div><p class="help">' + (folder ? 'Folders can be nested up to 5 levels. Greyed folders cannot take this one.' : 'The note keeps its tags, its pin and its history.') + '</p></div>';
    return dialog(folder ? 'Move Folder' : 'Move Note', folder ? 'Custodians: 3 subfolders, 10 notes' : 'Custodian interview: R. Alvarez (CFO)', body, '<span class="sp"></span><button class="btn">Cancel</button><button class="btn btn--primary">' + (folder ? 'Move Folder' : 'Move Note') + '</button>');
  }
  function deleteDialog(empty) {
    if (empty) {
      return dialog('Delete Folder', '', '<p style="margin:0">Volume 002 is empty. This can\'t be undone.</p>', '<span class="sp"></span><button class="btn">Cancel</button><button class="btn btn--solid-danger">Delete Folder</button>', 'sm');
    }
    return dialog('Delete Folder', '', '<p style="margin:0 0 var(--mf-s2)">Round 2 Terms holds 3 notes. A folder with notes in it can\'t be deleted as it is.</p><p style="margin:0">Move Contents Up puts the 3 notes into Search Terms and Validation, then deletes the empty folder. No note is deleted.</p>',
      '<span class="sp"></span><button class="btn">Cancel</button><button class="btn btn--primary">Move Contents Up and Delete</button>', 'md');
  }

  /* ---------- editor scenes ---------- */
  const SHOT_ROWS = [['HART-00412', '03/14/2019', 'R. Alvarez', 'M. Chen; L. Park', 'AC', 'Email re legal advice', 1], ['HART-00413', '03/14/2019', 'M. Chen', 'R. Alvarez', 'AC', 'Reply re merger counsel', 0], ['HART-00419', '03/19/2019', 'L. Park', 'Outside counsel', 'WP', 'Draft agreement markup', 0], ['HART-00420', '03/20/2019', 'R. Alvarez', 'Board', 'AC', 'Email re legal advice', 1], ['HART-00431', '04/02/2019', 'T. Hsu', 'R. Alvarez', 'AC', 'Memo re regulatory review', 0], ['HART-00436', '04/03/2019', 'M. Chen', 'T. Hsu; L. Park', 'CI', 'Email chain re joint defense', 0]];
  function shot() {
    const cell = (c, cls) => '<span class="c' + (cls ? ' ' + cls : '') + '">' + esc(c) + '</span>';
    return '<span class="shot" role="img" aria-label="Screenshot of the privilege log spreadsheet, first six rows"><span class="bar"><i></i>Privilege Log - Batch 3.xlsx</span><span class="cols">' +
      ['Control No.', 'Date', 'Author', 'Recipients', 'Basis', 'Description'].map((h) => cell(h, 'h')).join('') +
      SHOT_ROWS.map((r) => r.slice(0, 6).map((c, i) => cell(c, r[6] && i === 5 ? 'y' : '')).join('')).join('') + '</span></span>';
  }
  const TBAR = '<div class="tbar" role="toolbar" aria-label="Text formatting"><span class="pdd">Paragraph ' + ic('angle-down') + '</span><span class="dv"></span><button class="tb">B</button><button class="tb i">I</button><button class="tb u">U</button><button class="tb" aria-label="Text color">' + ic('palette') + '</button><span class="dv"></span><button class="tb" aria-label="Bulleted list">' + ic('list') + '</button><button class="tb" aria-label="Numbered list">' + ic('sort-numeric-down') + '</button><button class="tb" aria-label="Quote">' + ic('comment') + '</button><span class="dv"></span><button class="tb" aria-label="Link">' + ic('link') + '</button><button class="tb" aria-label="Insert table, 3 by 3">' + ic('table') + '</button><button class="tb">@</button><button class="tb">#</button><span class="dv"></span><button class="tb" aria-label="Clear formatting">' + ic('eraser') + '</button><button class="tb" aria-label="Undo">' + ic('undo') + '</button><button class="tb" aria-label="Redo">' + ic('refresh') + '</button></div>';
  function edHead() {
    return '<div class="np-h">' + where(2) + '<span class="sp"></span><span class="chip chip--neutral">' + ic('pencil') + 'Editing</span></div>';
  }
  function edFoot(disabledSave, why) {
    return '<div class="np-f"><button class="btn">Cancel</button><span class="sp"></span>' + (why ? '<span class="why">' + ic('info-circle') + why + '</span>' : '') + '<button class="btn btn--primary"' + (disabledSave ? ' disabled' : '') + '>Save</button></div>';
  }
  function figure(w, h, opts) {
    opts = opts || {};
    const pct = Math.round((w / 960) * 100);
    return '<span class="fig' + (opts.sel ? ' is-sel' : '') + (opts.read ? ' read' : '') + '" style="--w:' + w + 'px" tabindex="0">' +
      (opts.sel ? '<span class="imgbar" role="toolbar" aria-label="Image tools"><button class="b" aria-pressed="false">Small</button><button class="b" aria-pressed="true">Medium</button><button class="b" aria-pressed="false">Large</button><button class="b" aria-pressed="false">Original</button><button class="b" aria-pressed="false">Fit to Width</button><span class="dv"></span><button class="b">' + ic('pencil') + 'Alt Text</button><button class="b dng">' + ic('trash') + 'Remove</button></span>' : '') +
      shot() +
      (opts.sel ? '<span class="hd nw"></span><span class="hd ne"></span><span class="hd sw"></span><span class="hd se"></span><span class="readout" role="status"><b>' + w + ' x ' + h + ' px</b> &middot; ' + pct + '% of original</span>' : '') +
      (opts.read ? '<span class="cap">Click to open the full size in a new tab</span>' : '') + '</span>';
  }
  function imageScene() {
    const read = S.scene === 'image-read';
    const body = '<div class="np-b"><div class="doc ed" contenteditable="false"><h1>Log batch 3: column mapping check</h1><p' + (read ? '' : ' style="margin-bottom:48px"') + '>Hannah\'s export cuts the privilege basis column short. The yellow rows need a rewrite before Friday.</p>' +
      '<p>' + figure(480, 300, { sel: !read, read: read }) + '</p><p style="margin-top:' + (read ? 8 : 40) + 'px">Next step: re-export with the full width and send to Mei Lin for QC.' + (read ? '' : '<span class="caret"></span>') + '</p></div></div>';
    const note = read ? '<section class="nt__note"><div class="np-h">' + where(2) + '<span class="sp"></span><button class="btn">' + ic('pencil') + 'Edit</button><button class="ibtn" aria-label="History">' + ic('history') + '</button><button class="ibtn" aria-label="More actions">' + ic('ellipsis-h') + '</button></div>' + body + '</section>'
      : '<section class="nt__note">' + edHead() + TBAR + body + edFoot(false) + '</section>';
    return card(tree() + list() + note, S.rail ? 'nt--rail' : '');
  }
  const REASONS = {
    size: ['Couldn\'t add the image.', 'It is larger than 2 MB even after shrinking. Crop it or take a smaller screenshot.'],
    type: ['Couldn\'t add the image.', 'This image type isn\'t supported. Paste a PNG or JPEG, or take a screenshot.'],
    count: ['Couldn\'t add the image.', 'A note can hold up to 20 images. Remove one first.'],
    offline: ['Couldn\'t add the image.', 'The upload didn\'t finish. Check your connection and try again.'],
    access: ['Couldn\'t add the image.', 'You don\'t have permission to add images to this matter\'s notes.'],
    locked: ['Couldn\'t add the image.', 'This note was locked by Tomas Berg while you were editing.'],
  };
  function failScene() {
    const r = REASONS[S.reason] || REASONS.size;
    const retry = ['offline', 'size'].includes(S.reason) ? '' : '';
    const body = '<div class="np-b"><div class="doc ed"><h1>Log batch 3: export screenshots</h1><p>Two screenshots from the review platform. The first has the full column set; the second shows the error banner.</p>' +
      '<div class="ph-bad" role="alert">' + ic('exclamation-triangle') + '<div class="tx"><b>' + r[0] + '</b><span>' + r[1] + '</span><div class="acts">' + (S.reason === 'access' || S.reason === 'locked' ? '' : '<button class="btn btn--text sm">' + ic('refresh') + 'Retry</button>') + '<button class="btn btn--text sm">Remove</button></div></div></div>' +
      '<div class="ph-up" role="status">' + ic('spinner', 'pi-spin') + '<div class="tx"><b>Adding image...</b><span>error-banner.png &middot; 1.4 MB</span><div class="prog" role="progressbar" aria-valuenow="62" aria-valuemin="0" aria-valuemax="100" aria-label="Upload progress"><i style="width:62%"></i></div></div></div>' +
      '<p>Both go to Mei Lin for QC.<span class="caret"></span></p></div></div>';
    return card(tree() + list() + '<section class="nt__note">' + edHead() + TBAR + body + edFoot(true, 'Save is off until the image is added or removed.') + '</section>', 'nt--rail');
  }
  function imageDetails() {
    return dialog('Image Details', '', '<div class="row2"><div><img alt="" src="" style="display:none"><span class="thumb-sm fig" style="display:block;--w:120px;width:120px;margin:0">' + shot() + '</span></div><div><div class="fld"><label class="lbl" for="alt">Alt Text</label><textarea id="alt" class="inp" maxlength="200" aria-describedby="alth">Privilege log spreadsheet, first six rows: control number, date, author, recipients, basis and description.</textarea><div style="display:flex"><p class="help" id="alth">Read aloud by screen readers and found by search.</p><span class="cc">104 / 200</span></div></div>' +
      '<div class="fld"><span class="lbl" id="szl">Size</span><div class="sizes" role="group" aria-labelledby="szl"><button aria-pressed="false">Small</button><button aria-pressed="true">Medium</button><button aria-pressed="false">Large</button><button aria-pressed="false">Original</button><button aria-pressed="false">Fit to Width</button></div></div>' +
      '<div class="fld" style="max-width:200px"><label class="lbl" for="wd">Width (px)</label><input id="wd" class="inp" value="480" inputmode="numeric"><p class="help">Height follows: 300 px. Original is 960 x 600 px.</p></div></div></div>',
      '<button class="btn btn--text danger">' + ic('trash') + 'Remove Image</button><span class="sp"></span><button class="btn">Cancel</button><button class="btn btn--primary">Save Changes</button>', 'lg');
  }

  /* ---------- paste scenes ---------- */
  const WORD_TABLE = '<table><thead><tr><th>Custodian</th><th>Source</th><th>Status</th></tr></thead><tbody><tr><td>R. Alvarez</td><td>Laptop, tablet</td><td>Imaged</td></tr><tr><td>M. Chen</td><td>iPhone</td><td>Scheduled</td></tr></tbody></table>';
  function pasteScene() {
    const word = '<div class="word"><h1>Custodian Collection Plan</h1><p><b>Status as of Monday.</b> The first wave is <i>complete</i>; <span class="red">the iPhone for M. Chen is late</span> and <s>the Slack export is done</s> <span class="hl">needs a recheck</span>.</p><p>Next steps:</p><ul><li>Image the tablet</li><li>Confirm retention with IT<ul><li>Slack: 90 days</li></ul></li></ul>' + WORD_TABLE + '<p>Details: <a href="#">Collection tracker</a></p></div>';
    const flat = '<pre class="flat">Custodian Collection Plan\nStatus as of Monday. The first wave is complete; the iPhone for M. Chen is late and the Slack export is done needs a recheck.\nNext steps:\n·  Image the tablet\n·  Confirm retention with IT\n o  Slack: 90 days\nCustodian\tSource\tStatus\nR. Alvarez\tLaptop, tablet\tImaged\nM. Chen\tiPhone\tScheduled\nDetails: Collection tracker</pre>';
    const after = '<div class="doc ed"><h1>Custodian Collection Plan</h1><p><b>Status as of Monday.</b> The first wave is <i>complete</i>; the iPhone for M. Chen is late and the Slack export is done needs a recheck.</p><p>Next steps:</p><ul><li>Image the tablet</li><li>Confirm retention with IT<ul><li>Slack: 90 days</li></ul></li></ul>' + WORD_TABLE + '<p>Details: <a href="#">Collection tracker</a><span class="caret"></span></p></div>' +
      '<div style="margin-top:var(--mf-s3)"><span class="po-wrap"><span class="po" role="toolbar" aria-label="Paste options">' + ic('clipboard') + 'Pasted with formatting<button class="ibtn ibtn--sm" aria-label="Paste options" aria-haspopup="menu">' + ic('angle-down') + '</button></span></span></div>';
    const cards = '<div class="cmp"><section aria-label="Copied from Word"><h2>' + ic('file-word') + 'Copied from Word <small>Collection_Plan_v3.docx</small></h2><div class="body">' + word + '</div><div class="foot">The source: heading style, bold, italic, red and struck-through text, highlight, a list, a table and a link.</div></section>' +
      '<section aria-label="Today"><h2>' + ic('times-circle') + 'Today <small>plain text only</small></h2><div class="body"><div class="doc">' + flat + '</div></div><div class="foot">One paragraph. Bullets are typed characters, the table is tab-separated text, the link is lost.</div></section>' +
      '<section aria-label="Round 2"><h2>' + ic('check-circle') + 'Round 2 <small>formatting kept</small></h2><div class="body">' + after + '</div><div class="foot" style="display:block"><ul class="drops" style="margin:0"><li>' + ic('check') + 'Kept: heading, bold, italic, list, table with header row, link</li><li>' + ic('times') + 'Dropped: red text, strikethrough, highlight, fonts, sizes, images in text</li></ul></div></section></div>';
    return cards;
  }
  function plainScene() {
    const body = '<div class="np-b"><div class="doc ed"><h1>Custodian Collection Plan</h1><p><b>Status as of Monday.</b> The first wave is <i>complete</i>; the iPhone for M. Chen is late and the Slack export is done needs a recheck.</p><p>Next steps:</p><ul><li>Image the tablet</li><li>Confirm retention with IT<ul><li>Slack: 90 days</li></ul></li></ul>' +
      '<p>Details: <a href="#">Collection tracker</a><span class="caret"></span></p>' +
      '<div style="position:relative;margin-top:var(--mf-s2)"><span class="po-wrap"><span class="po" role="toolbar" aria-label="Paste options">' + ic('clipboard') + 'Pasted with formatting<button class="ibtn ibtn--sm" aria-label="Paste options" aria-haspopup="menu" aria-expanded="true" style="background:var(--mf-selected-bg);color:var(--mf-primary)">' + ic('angle-down') + '</button></span>' +
      '<div class="po-menu" role="menu" aria-label="Paste options"><button role="menuitemradio" aria-checked="true">' + ic('check') + '<span><b>Keep Formatting</b><span>Headings, bold, italic, lists, tables and links stay as copied.</span></span></button>' +
      '<button role="menuitemradio" aria-checked="false"><span class="pi" style="width:18px"></span><span><b>Paste as Plain Text</b><span>Replaces this paste with its text only, no layout.</span></span></button>' +
      '<div class="hint">In the browser, <kbd class="k">Ctrl</kbd> + <kbd class="k">Shift</kbd> + <kbd class="k">V</kbd> pastes as plain text from the start.</div></div></span></div></div></div>';
    return card(tree() + list() + '<section class="nt__note">' + edHead() + TBAR + body + edFoot(false) + '</section>', 'nt--rail');
  }

  /* ---------- toast + mockup guide ---------- */
  function toasts() {
    if (S.scene === 'paste') return '<div class="toast-host top"><div class="toast toast--info" role="status">' + ic('info-circle') + '<div class="tt"><b>Pasted without 2 images</b><span>Images inside copied text can\'t be kept. Paste an image on its own, or take a screenshot.</span></div><button class="btn btn--icon" aria-label="Close">' + ic('times') + '</button></div></div>';
    if (S.scene === 'drag') return '';
    return '';
  }
  function guide() {
    return '<button class="mk-pill" data-g="1">' + ic('book') + 'Mockup Guide</button>' + (S.guide ? '<div class="mk-panel" role="dialog" aria-label="Mockup guide"><h2>Notes round 2 (#1406)</h2><p>Mock data. Nothing saves. Desktop sizes only: 1366x768 and 1920x1080.</p><h3>Scenes</h3>' +
      SCENES.map(([k, l]) => '<a href="?scene=' + k + (S.guide ? '&guide=1' : '') + '"' + (k === S.scene ? ' class="cur" aria-current="true"' : '') + '>' + esc(l) + '</a>').join('') + '<h3>Options</h3><p>?err=dup|empty|long for the folder name dialogs; ?reason=size|type|count|offline|access|locked for image-fail; ?rail=0 or 1; ?chrome=0 hides this guide.</p></div>' : '') + '<div class="mk-badge">Mockup. Not the product.</div>';
  }

  /* ---------- render ---------- */
  function render() {
    const s = S.scene;
    let html;
    let overlay = '';
    if (s === 'paste') {
      html = frame(pasteScene());
    } else if (s === 'plain') {
      html = frame(plainScene());
    } else if (s === 'image' || s === 'image-read') {
      html = frame(imageScene());
    } else if (s === 'image-details') {
      html = frame(imageScene()); overlay = imageDetails();
    } else if (s === 'image-fail') {
      html = frame(failScene());
    } else {
      html = frame(card(tree() + list() + notePanel(), S.rail ? 'nt--rail' : ''));
      if (s === 'new-folder') overlay = nameDialog('new');
      if (s === 'rename') overlay = nameDialog('rename');
      if (s === 'move-folder') overlay = moveDialog('folder');
      if (s === 'move-note') overlay = moveDialog('note');
      if (s === 'delete') overlay = deleteDialog(false);
      if (s === 'delete-empty') overlay = deleteDialog(true);
    }
    $root.innerHTML = html + overlay + toasts() + guide();
    if (S.menu === 'folder') { /* the row menu is part of the tree markup */ }
    if (s === 'drag') placeDrag();
    document.title = 'Notes Round 2 Mockup';
  }
  function placeDrag() {
    const tgt = document.querySelector('.tr[data-f="7"]');
    const nt = document.querySelector('.nt');
    if (!tgt || !nt) return;
    tgt.classList.add('drop');
    const cardR = nt.getBoundingClientRect(); const r = tgt.getBoundingClientRect();
    const g = document.createElement('div'); g.className = 'dragghost'; g.setAttribute('aria-hidden', 'true');
    g.innerHTML = '<b>M. Chen mobile device collection status</b><span>Custodian, Action Item</span><span class="ok">' + ic('arrow-right') + 'Move to Custodians > IT and Records</span>';
    g.style.left = (r.right + 14 - cardR.left) + 'px'; g.style.top = (r.top - cardR.top + 6) + 'px';
    nt.style.position = 'relative'; nt.style.overflow = 'visible'; nt.appendChild(g);
  }
  document.addEventListener('click', function (e) {
    const t = e.target.closest ? e.target.closest('[data-g]') : null;
    if (t) { S.guide = !S.guide; render(); }
  });
  setup();
  render();
})();
