/**
 * Task 16-f — proxy plumbing end-to-end test.
 * Proves BOTH transport paths the app uses for source proxies:
 *   A. undici ProxyAgent (HTTP engines: cheerio/crawlee/probe/fetchers)
 *   B. Playwright chromium { proxy: { server } } (browser engine)
 * Uses a tiny local CONNECT proxy — no external credentials needed.
 */
import net from "node:net";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const PROXY_PORT = 31280;

function startConnectProxy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      client.on("error", () => {});
      client.once("data", (first) => {
        const head = first.toString("latin1");
        const m = head.match(/^CONNECT ([^\s:]+):(\d+)/);
        if (!m) {
          client.end("HTTP/1.1 400 Bad Request\r\n\r\n");
          return;
        }
        const [, host, portStr] = m;
        const upstream = net.connect(Number(portStr), host, () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.write(first.slice(first.indexOf("\r\n\r\n") + 4) || Buffer.alloc(0));
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.destroy());
      });
    });
    server.on("error", reject);
    server.listen(port, () => () => {});
    resolve(server);
  });
}

const server = await startConnectProxy(PROXY_PORT);
console.log(`local CONNECT proxy on 127.0.0.1:${PROXY_PORT}`);

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) failures++;
}

// A) undici ProxyAgent path
try {
  const agent = new ProxyAgent({ uri: `http://127.0.0.1:${PROXY_PORT}` });
  const t0 = Date.now();
  const res = await undiciFetch("https://example.com", { dispatcher: agent, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  check(`A. undici ProxyAgent → example.com ${res.status} (${Date.now() - t0}ms)`, res.ok && text.includes("Example Domain"));
} catch (e) {
  check("A. undici ProxyAgent → example.com", false, e.message);
}

// B) Playwright browser proxy path
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  const title = await page.title();
  await browser.close();
  check(`B. Playwright via proxy → example.com title="${title}"`, title.includes("Example"), title);
} catch (e) {
  check("B. Playwright via proxy → example.com", false, e.message);
}

server.close();
console.log(failures === 0 ? "\nALL PROXY PLUMBING TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
