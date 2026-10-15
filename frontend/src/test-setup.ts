// Runs before every spec file. PrimeNG dialogs and big tables are slow when the machine is busy (a full run uses every core), and the default
// 5 s made otherwise correct specs time out. A real hang still fails, only later.
vi.setConfig({ testTimeout: 20_000 });
