# Matter one-page mockup (#1396, epic #1389)

Mockup only: static HTML, CSS and JS, no build, no network, nothing saves, no app code changed. Open `index.html` in a browser (double-click). Sizes: 1366x768 and 1920x1080 (desktop only). Tokens are a copy of `docs/ux/tokens.css`; icons are PrimeIcons. All data is invented.

- `index.html`: the one continuous matter page. The seven tabs of today's Matter page (Summary, Tasks, Projects, Assets, Productions, Notes, Activities) become sections in the same order. The strip under the title is sticky and jumps to a section, and the section you are in is highlighted. Summary comes first and looks as today (asset tiles, Details, side column with Team and Vendors). Every other section is a card with a compact grid and a footer "Showing 10 of 38 tasks" with "Open Full View".
- `full-view.html?tab=tasks`: today's full tab page, which "Open Full View" opens (the `?tab=` deep links stay). Tabs: `tasks`, `projects`, `assets`, `productions`, `notes`, `activities`.
- The **Mockup Guide** pill (bottom left) lists the screens and has switches: loading behaviour (normal, hold the placeholders, Notes fails), Productions empty or with data, rows per section (5, 10, 15), and a viewer without Asset and Audit rights.
- URL options: `?chrome=0` hides the guide, `?guide=1` opens it, `?load=hold|fail`, `?prod=data`, `?rows=5|15`, `?viewer=limited`, `#assets` scrolls to a section.

No keyboard shortcut is added or changed (#420).
