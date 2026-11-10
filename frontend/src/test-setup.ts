// Runs before every spec file. PrimeNG dialogs and big tables are slow when the machine is busy (a full run uses every core), and the default
// 5 s made otherwise correct specs time out. A real hang still fails, only later.
vi.setConfig({ testTimeout: 20_000 });

// Leak guard (#1329, #1354). A spec that leaves a rendered table in the document (a fixture that was not destroyed, a table moved to <body>
// by an overlay) poisons every later spec of the same file that reads `document.body` or `document.querySelector('table')`: they flake,
// and only in some orders. After each test the testing module is torn down the way Angular does it, and then no <table> may remain in
// the document. The offending test is named in the failure, the stray tables are removed so the specs after it still run on a clean page.
afterEach(async () => {
  const { getTestBed } = await import('@angular/core/testing');
  getTestBed().resetTestingModule();
  const strays = Array.from(document.body.querySelectorAll('table'));
  if (strays.length === 0) return;
  const where = strays
    .map(
      (t) =>
        `<table class="${t.className}"> in <${t.parentElement?.tagName.toLowerCase()} class="${t.parentElement?.className}">`,
    )
    .join('; ');
  strays.forEach((t) => t.remove());
  throw new Error(
    `This test left ${strays.length} table element(s) in the document after the testing module was torn down: ${where}. ` +
      `Destroy the fixture / close the overlay the test opened (#1329).`,
  );
});
