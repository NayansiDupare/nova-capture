// Starts Electron with ELECTRON_RUN_AS_NODE removed. VS Code terminals set it, which makes
// Electron behave like plain Node (require('electron') then has no app/BrowserWindow).

const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

spawn(electronPath, ['.'], { cwd: __dirname, env, stdio: 'inherit' }).on('exit', (code) =>
  process.exit(code ?? 1),
);
