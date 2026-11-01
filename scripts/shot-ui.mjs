import { build } from 'vite';
import { resolve, extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';

/**
 * 界面版式核对：把 mock.html 打成静态页，用本机 Chrome 无头截图。
 *
 * 两件必须注意的事：
 * 1. Chrome 会拦截 file:// 下的 ES module（CORS），所以必须起一个本地静态服务；
 * 2. 服务只绑 127.0.0.1，不绑 0.0.0.0——这只是给截图用的临时服务。
 */
const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'scripts/.out/mock');

await build({
  root: resolve(root, 'src/renderer'),
  configFile: false,
  logLevel: 'warn',
  base: './',
  resolve: { alias: { '@shared': resolve(root, 'src/shared') } },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: { input: { mock: resolve(root, 'src/renderer/mock.html') } },
  },
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const file = join(outDir, url === '/' ? 'mock.html' : url);
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const shot = resolve(root, 'docs/ui-preview.png');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const height = Number(process.argv[2] ?? 1500);
const extra = process.argv[4] ? `&${process.argv[4]}` : '';
const scroll = Number(process.argv[3] ?? 0);
const qs = [scroll ? `scroll=${scroll}` : '', process.argv[4] ?? ''].filter(Boolean).join('&');

try {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${join(root, 'scripts/.out/chrome-profile')}`,
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      `--window-size=1500,${height}`,
      '--virtual-time-budget=3000',
      `--screenshot=${shot}`,
      `file:///${resolve(outDir, 'mock.html').split('\\').join('/')}${qs ? `?${qs}` : ''}`,
    ],
    { stdio: 'inherit', timeout: 25000 }
  );
} finally {
  server.close();
}

console.log('截图已生成：', shot);
