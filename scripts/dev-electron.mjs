import { spawn } from 'node:child_process';

const devUrl = 'http://127.0.0.1:4173';
const vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BROWSER: 'none',
  },
});

let shuttingDown = false;

const shutdown = () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  vite.kill('SIGTERM');
};

async function waitForServer(url, retries = 60) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Vite dev server did not start at ${url}`);
}

try {
  await waitForServer(devUrl);

  const electron = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['electron', '.'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        ELECTRON_START_URL: devUrl,
      },
    },
  );

  electron.on('exit', (code) => {
    shutdown();
    process.exit(code ?? 0);
  });
} catch (error) {
  shutdown();
  console.error(error);
  process.exit(1);
}

vite.on('exit', (code) => {
  if (!shuttingDown) {
    process.exit(code ?? 1);
  }
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
