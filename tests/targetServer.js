import http from 'node:http';
import zlib from 'node:zlib';

// PNG signature followed by arbitrary bytes, including a NUL.
export const BINARY_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const routes = {
  async '/echo'(req, res, url) {
    const body = await readBody(req);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        method: req.method,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      }),
    );
  },
  '/redirect'(req, res, url) {
    res.writeHead(Number(url.searchParams.get('status') ?? 302), {
      Location: url.searchParams.get('to'),
    });
    res.end();
  },
  '/loop'(req, res) {
    res.writeHead(302, { Location: '/loop' });
    res.end();
  },
  '/slow'(req, res) {
    setTimeout(() => res.end('late'), 5000).unref();
  },
  '/big'(req, res, url) {
    res.setHeader('Content-Type', 'text/plain');
    res.end('x'.repeat(Number(url.searchParams.get('bytes'))));
  },
  '/gzip'(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync(JSON.stringify({ compressed: true })));
  },
  '/gzip-bomb'(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
    res.end(zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024, 'a')));
  },
  // Valid gzip header and a partial body, then nothing: the decoder must not wait forever.
  '/gzip-stall'(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
    res.write(zlib.gzipSync(Buffer.alloc(64 * 1024, 'a')).subarray(0, 100));
  },
  // Partial gzip body, then the connection is cut.
  '/gzip-cut'(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
    res.write(zlib.gzipSync(Buffer.alloc(64 * 1024, 'a')).subarray(0, 100), () =>
      setTimeout(() => req.socket.destroy(), 50),
    );
  },
  '/bad-redirect'(req, res) {
    res.writeHead(302, { Location: 'http://[::1' });
    res.end();
  },
  '/binary'(req, res) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(BINARY_BYTES);
  },
  '/status'(req, res, url) {
    res.writeHead(Number(url.searchParams.get('code')), { 'Set-Cookie': ['a=1', 'b=2'] });
    res.end('status body');
  },
};

export async function startTargetServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://placeholder');
    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    route(req, res, url);
  });

  // No host: listens on all interfaces, so both 127.0.0.1 and localhost (::1) reach it.
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return {
    port,
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
