import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3030;

function getPidByPort(port) {
  try {
    if (process.platform === 'win32') {
      const stdout = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      for (const line of stdout.trim().split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') return pid;
        }
      }
    } else {
      return execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf8' }).trim();
    }
  } catch {}
  return null;
}

function killPid(pid) {
  try {
    execSync(process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, { stdio: 'ignore' });
  } catch {}
}

const cmd = process.argv[2];

if (cmd === 'start' || cmd === 'restart') {
  const existingPid = getPidByPort(PORT);
  if (existingPid) {
    console.log(`Deteniendo proceso existente en puerto ${PORT} (PID: ${existingPid})`);
    killPid(existingPid);
  }
  const serverScript = path.join(__dirname, 'predict-server.mjs');
  if (process.platform === 'win32') {
    execSync(`start /B node "${serverScript}"`, { stdio: 'ignore' });
  } else {
    execSync(`nohup node "${serverScript}" > /dev/null 2>&1 &`, { stdio: 'ignore' });
  }
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
} else if (cmd === 'stop') {
  const pid = getPidByPort(PORT);
  if (pid) {
    killPid(pid);
    console.log(`Servidor detenido (PID: ${pid})`);
  } else {
    console.log('No hay servidor corriendo en el puerto ' + PORT);
  }
} else if (cmd === 'status') {
  const pid = getPidByPort(PORT);
  if (pid) {
    console.log(`Servidor corriendo en http://localhost:${PORT} (PID: ${pid})`);
  } else {
    console.log('Servidor NO está corriendo');
  }
} else {
  console.log('Uso: node server-manager.mjs [start|stop|status|restart]');
}
