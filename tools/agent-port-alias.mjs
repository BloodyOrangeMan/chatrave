#!/usr/bin/env node
import http from 'node:http';

const targetHost = process.env.CHATRAVE_AGENT_ALIAS_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.CHATRAVE_AGENT_ALIAS_TARGET_PORT || '4174');
const listenHost = process.env.CHATRAVE_AGENT_ALIAS_HOST || '0.0.0.0';
const listenPort = Number(process.env.CHATRAVE_AGENT_ALIAS_PORT || '4175');

const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    {
      host: targetHost,
      port: targetPort,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (error) => {
    const message = JSON.stringify({ error: `agent alias proxy failure: ${error.message}` });
    res.writeHead(502, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(message)),
    });
    res.end(message);
  });

  req.pipe(proxyReq);
});

server.listen(listenPort, listenHost, () => {
  // eslint-disable-next-line no-console
  console.log(`[chatrave][agent-alias] listening on http://${listenHost}:${listenPort} -> http://${targetHost}:${targetPort}`);
});
