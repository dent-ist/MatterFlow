// Generates the email-first mocks (desktop and phone). Run: node build-ef.mjs
import fs from 'node:fs';
const P = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  up: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  scale: '<path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  clip: '<path d="M9 5h-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v4h1"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const shell = (phone, body, bar = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create task mock</title><link rel="stylesheet" href="mock-app.css">
<body class="${phone ? 'ph' : ''}"><div class="app"><div class="top"><b>MatterFlow</b><span class="srch">Search tasks, matters, clients</span><span class="btn p sm">${ic('plus', 's')} Create task</span></div>
<nav class="rail"><span>Dashboard</span><span>My Work</span><span class="on">Tasks</span><span>Matters</span><span>Clients</span></nav>
<main class="page">${body}${bar}</main></div></body></html>`;
const head = (sub = 'Start from an email, or choose a task type') => `<div class="crumb">Tasks &gt; Create task</div><h1>Create task</h1><div class="ctx">${sub}</div>`;
const demo = `<span class="demo">${ic('spark', 's')} Demo mode: suggestions are simulated. Nothing is sent to an AI service.</span>`;
const tiles = (n = 8, sel = -1) => {
  const t = ['Privilege Review', 'Production Request', 'Data Processing', 'Legal Hold Issue', 'Redaction Request', 'Mailbox Collection', 'QC Sampling', 'Bates Numbering', 'Search Term Report', 'Workspace Setup'];
  return `<div class="tiles">${t.slice(0, n).map((x, i) => `<div class="tile ${i === sel ? 'sel' : ''}"><span class="ti">${ic(['scale', 'box', 'file', 'lock', 'clip', 'mail'][i % 6], 's')}</span><span class="nm">${x}</span></div>`).join('')}</div>`;
};
const dropEmpty = `<section class="card pad" aria-label="Start from an email"><div class="row" style="margin-bottom:10px"><h2>Start from an email</h2><span class="pill in">Fastest way</span><span class="sp">${demo}</span></div>
<div class="drop">${ic('mail', 'l')}<div class="big">Drop an email here</div><div class="mut">Outlook message (.msg) or saved email (.eml), up to 10 MB</div>
<div class="row" style="margin-top:6px"><span class="btn p">${ic('up', 's')} Browse files</span><span class="btn">${ic('clip', 's')} Paste email text</span></div></div>
<p class="hint" style="margin:10px 0 0">${ic('lock', 's')} We read the subject, sender, date and body, then forget the file. Attachments and the original email are not saved. What you keep is what you review and create.</p></section>
<div class="sepline">or choose the task type yourself</div>
<div class="row" style="margin-bottom:8px"><h2>What kind of task is this?</h2><span class="sp xs mut">20 of 64 task types shown. Search or browse by group.</span></div>
<div class="inp" style="max-width:360px;margin-bottom:8px">Search task types</div>${tiles(10)}`;
const dropReading = `<section class="card pad"><div class="row" style="margin-bottom:10px"><h2>Start from an email</h2><span class="sp">${demo}</span></div>
<div class="drop over"><div class="row"><span class="ti" style="width:36px;height:36px;border-radius:6px;background:#fff;display:grid;place-items:center;color:var(--primary)">${ic('mail')}</span><div style="text-align:left"><b>Re: Production deadline moved to Friday - Falcon.msg</b><div class="xs mut">84 KB, Outlook message</div></div></div>
<div class="steps" style="text-align:left;margin-top:10px;min-width:260px"><div class="st"><span class="dot done">${ic('check', 's')}</span>Read the file</div><div class="st"><span class="dot done">${ic('check', 's')}</span>Found sender, date and subject</div><div class="st"><span class="dot now">3</span><b>Suggesting a task type and matter...</b></div></div>
<div class="bar" style="width:100%;max-width:360px;margin-top:8px" role="progressbar" aria-label="Reading the email"><i style="width:66%"></i></div>
<span class="btn sm" style="margin-top:8px">Cancel</span></div>
<p class="hint" style="margin:10px 0 0" role="status">Reading the email. This usually takes a few seconds. You can still type the task yourself below.</p></section>
<div class="sepline">or choose the task type yourself</div>${tiles(4)}`;
const emailCard = `<section class="card pad"><div class="row"><h3>The email</h3><span class="pill ok">${ic('check', 's')} Read</span><span class="sp btn t sm">Replace file</span></div>
<div class="sm" style="margin-top:8px;display:grid;gap:2px"><div><span class="mut">From</span> <b>Dana Whitfield</b> &lt;dana.whitfield@falconcorp.example&gt;</div><div><span class="mut">Sent</span> Oct 19, 2026 4:42 PM</div><div><span class="mut">Subject</span> <b>Re: Production deadline moved to Friday - Falcon</b></div></div>
<div class="sm" style="margin-top:8px;border-left:3px solid var(--border);padding-left:10px;color:var(--muted)">Hi team, the court moved the production deadline to <mark>Friday</mark>. Before anything goes out we need a <mark>privilege check</mark> on the 1,200 documents from the Falcon custodians and the <mark>privilege log</mark> updated...</div>
<div class="xs mut" style="margin-top:6px">Highlighted words are what the suggestion was based on. Attachments (2) were ignored and are not saved.</div></section>`;
const sugg = `<section class="card pad" style="border-color:var(--primary);border-width:2px" aria-label="Suggested task type"><div class="row"><span class="pill in">${ic('spark', 's')} Suggested task type</span><span class="sp pill ok">High confidence</span></div>
<div class="row" style="margin:10px 0"><span class="ti" style="width:44px;height:44px;border-radius:8px;background:var(--sel);color:var(--primary);display:grid;place-items:center">${ic('scale', 'l')}</span><div><h2>Privilege Review</h2><div class="xs mut">Review a set for attorney-client privilege.</div></div></div>
<div class="row"><div class="bar" style="flex:1" role="img" aria-label="Match 87 percent"><i style="width:87%"></i></div><b>87%</b></div>
<p class="sm" style="margin:8px 0"><b>Why:</b> the email asks for a "privilege check" before a production and mentions the "privilege log".</p>
<div class="row" style="flex-wrap:wrap"><span class="btn p">${ic('check', 's')} Use Privilege Review</span><span class="btn">Choose another type</span></div>
<div class="sec"><div class="xs mut" style="margin-bottom:6px">Other possibilities</div><div style="display:grid;gap:6px"><div class="row sm"><span class="tile" style="min-height:36px;flex:1">Production QC</span><b>7%</b></div><div class="row sm"><span class="tile" style="min-height:36px;flex:1">Redaction Request</span><b>4%</b></div></div></div></section>
<section class="card pad" style="margin-top:12px"><h3>Matter</h3><div class="xs mut" style="margin-bottom:6px">Found in the subject: "Falcon". Pick one or search.</div><div style="display:grid;gap:6px">
<div class="tile sel" style="font-weight:400;min-height:48px"><span><b>00343-00012</b> Project Falcon Production<br><span class="xs mut">Acme Holdings. Active. Matched "Falcon" in subject</span></span><span class="sp pill ok">Best match</span></div>
<div class="tile" style="font-weight:400;min-height:48px"><span><b>00343-00031</b> Falcon Antitrust Second Request<br><span class="xs mut">Acme Holdings. Active</span></span></div>
<span class="btn t sm">Search another matter</span></div></section>`;
const review = (phone) => `${head('Review before you create. Nothing is saved yet.')}
<div class="alert in" style="margin-bottom:12px">${ic('info', 's')}<div><b>Prefilled from the email. Please check 2 things:</b> the matter, and the workflow. Everything else is ready.</div></div>
<div class="${phone ? '' : 'grid2'}"><div>
<section class="card pad"><div class="row"><span class="tile" style="min-height:40px;border-style:solid"><span class="ti">${ic('scale', 's')}</span>Task type: Privilege Review</span><span class="pill in">suggested, accepted</span><span class="sp btn t sm">Change type</span></div>
<h2 style="margin:12px 0 8px">Task</h2>
<div class="field"><label>Matter (required)</label><div class="inp pre">00343-00012 Project Falcon Production <span class="pill wn sp">Confirm</span></div></div>
<div class="field"><label>Title (required)</label><div class="inp pre">Re: Production deadline moved to Friday - Falcon <span class="pill in sp">From email</span></div></div>
<div class="field"><label>Description</label><div class="inp pre" style="align-items:flex-start;min-height:70px">Hi team, the court moved the production deadline to Friday. Before anything goes out we need a privilege check on the 1,200 documents...</div></div>
<h2 style="margin:12px 0 8px">Input</h2>
<div class="field"><label>Requestor name (required)</label><div class="inp pre">Dana Whitfield <span class="pill in sp">From email</span></div></div>
<div class="field"><label>Requestor email</label><div class="inp pre">dana.whitfield@falconcorp.example <span class="pill in sp">From email</span></div></div>
<div class="field"><label>Workflow (required)</label><div class="inp"><b>Privilege Review v3</b> <span class="mut">(5 steps, ordered, default)</span></div><div class="hint">Steps of an ordered workflow are done in order. This type has one workflow.</div></div>
<div class="row sm"><b>Priority, due date and assignment</b><span class="mut">Normal priority, no due date, Unassigned</span><span class="sp">${ic('chev', 's')}</span></div></section></div>
<aside class="${phone ? 'hide-ph' : ''}"><section class="card pad"><div class="row"><h3>Source email</h3><span class="sp btn t sm">Hide</span></div><div class="xs mut" style="margin:6px 0">Sent Oct 19, 2026 4:42 PM. Kept only on this screen.</div><div class="sm" style="border-left:3px solid var(--border);padding-left:10px;color:var(--muted)">Hi team, the court moved the production deadline to Friday. Before anything goes out we need a privilege check on the 1,200 documents from the Falcon custodians and the privilege log updated. Please confirm who can start today.<br><br>Thanks, Dana</div>
<div class="alert wn sm" style="margin-top:10px">${ic('lock', 's')}<div>The description is saved with the task and visible to everyone who can open it. Remove anything that should not be stored.</div></div></section></aside></div>`;
const reviewBar = `<div class="sticky"><span class="btn p">Create task</span><span class="btn">Create and add another</span><span class="btn t">Cancel</span></div>`;
const errors = `<section class="card pad"><div class="row" style="margin-bottom:10px"><h2>Start from an email</h2><span class="sp">${demo}</span></div>
<div style="display:grid;gap:10px">
<div class="alert dg" role="alert">${ic('x', 's')}<div><b>That file is not an email.</b> "Falcon-notes.pdf" can't be read. Choose a .msg or .eml file, or paste the email text.<div class="row" style="margin-top:6px"><span class="btn sm">Choose another file</span><span class="btn sm">Paste email text</span></div></div></div>
<div class="alert wn" role="alert">${ic('warn', 's')}<div><b>We read the email but could not suggest a task type.</b> Sender, subject and body are filled in. Choose the type below; your choice is not stored for training.</div></div>
<div class="alert wn" role="alert">${ic('warn', 's')}<div><b>Not sure: 41% match for "Production Request".</b> Check it before you use it.<div class="row" style="margin-top:6px"><span class="btn sm">Use Production Request</span><span class="btn sm">Choose another</span></div></div></div>
<div class="alert dg" role="alert">${ic('x', 's')}<div><b>The suggestion service is not available right now.</b> The email was read. Choose the task type yourself. <span class="btn sm" style="margin-left:6px">Try again</span></div></div>
</div></section><div class="sepline">choose the task type yourself</div>${tiles(6)}`;
const states = {
  '1-empty': head() + dropEmpty,
  '2-reading': head() + dropReading,
  '3-suggestion': head('Suggestion ready. You decide.') + `<div class="__G">${'<div>' + emailCard + '</div><div>' + sugg + '</div>'}</div>`,
  '4-review': null,
  '5-errors': head() + errors,
};
for (const phone of [false, true]) {
  for (const [k, v] of Object.entries(states)) {
    let body = v;
    if (k === '4-review') body = review(phone);
    body = body.replace('<div class="__G">', `<div class="${phone ? '' : 'grid2'}" style="${phone ? 'display:grid;gap:12px' : ''}">`);
    const html = shell(phone, body, k === '4-review' ? reviewBar : '');
    fs.writeFileSync(`mock-email-first-${k}-${phone ? 'phone' : 'desktop'}.html`, html);
  }
}
console.log('done');
