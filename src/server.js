import http from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createGame, GameError } from "./game.js";
const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
export function createServer({
  dbPath = process.env.DB_PATH || "data/deadbrowse.sqlite",
  clock = Date.now,
  secureCookies = process.env.NODE_ENV === "production",
  publicOrigin = process.env.PUBLIC_ORIGIN,
} = {}) {
  if (secureCookies && !publicOrigin)
    throw new Error(
      "PUBLIC_ORIGIN is required when Secure cookies are enabled.",
    );
  if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin)
    throw new Error(
      "PUBLIC_ORIGIN must be an exact origin without a trailing slash.",
    );
  if (dbPath !== ":memory:")
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const game = createGame(dbPath, { clock }),
    attempts = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (!path.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD")
          throw new GameError("Method not allowed.", 405);
        const files = {
          "/": ["index.html", "text/html"],
          "/app.js": ["app.js", "text/javascript"],
          "/styles.css": ["styles.css", "text/css"],
        };
        if (!files[path]) throw new GameError("Not found.", 404);
        const [file, mime] = files[path];
        const content = await readFile(resolve(publicDir, file));
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "no-cache",
        });
        res.end(req.method === "HEAD" ? undefined : content);
        return;
      }
      const token = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("deadbrowse="))
        ?.slice(11);
      if (req.method === "POST") {
        const expected =
          publicOrigin ||
          `${secureCookies ? "https" : "http"}://${req.headers.host}`;
        if (req.headers.origin !== expected)
          throw new GameError("Request origin rejected.", 403);
        if (req.headers["content-type"]?.split(";")[0] !== "application/json")
          throw new GameError("Send JSON.", 415);
      }
      async function body() {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (Buffer.byteLength(text) > 4096)
            throw new GameError("Request too large.", 413);
        }
        try {
          const result = JSON.parse(text);
          if (!result || typeof result !== "object" || Array.isArray(result))
            throw Error();
          return result;
        } catch {
          throw new GameError("Invalid JSON.");
        }
      }
      if (
        req.method === "POST" &&
        ["/api/register", "/api/login"].includes(path)
      ) {
        const ip = req.socket.remoteAddress,
          now = clock();
        for (const [key, value] of attempts)
          if (value.until <= now) attempts.delete(key);
        const bucket = attempts.get(ip) || { count: 0, until: now + 60_000 };
        bucket.count++;
        attempts.set(ip, bucket);
        if (bucket.count > 12)
          throw new GameError(
            "Too many sign-in attempts. Try again in a minute.",
            429,
          );
        const data = await body();
        const auth = await game.authenticate(
          path.slice(5),
          data.name,
          data.password,
        );
        res.setHeader(
          "Set-Cookie",
          `deadbrowse=${auth.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secureCookies ? "; Secure" : ""}`,
        );
        json(200, { csrf: auth.csrf, state: game.state(auth.id) });
        return;
      }
      const session = game.session(token);
      if (!session) throw new GameError("Sign in to continue.", 401);
      if (req.method === "GET" && path === "/api/state") {
        json(200, { csrf: session.csrf, state: game.state(session.user_id) });
        return;
      }
      if (req.method === "POST") {
        if (req.headers["x-csrf-token"] !== session.csrf)
          throw new GameError(
            "Session verification failed. Refresh and try again.",
            403,
          );
        if (path === "/api/logout") {
          game.logout(token);
          res.setHeader(
            "Set-Cookie",
            `deadbrowse=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? "; Secure" : ""}`,
          );
          json(200, { ok: true });
          return;
        }
        if (path === "/api/action") {
          json(200, { state: game.act(session.user_id, await body()) });
          return;
        }
      }
      throw new GameError("Not found.", 404);
    } catch (error) {
      if (!(error instanceof GameError)) console.error(error);
      json(error.status || 500, {
        error:
          error instanceof GameError
            ? error.message
            : "An unexpected server error occurred.",
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, game };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { server, game } = createServer();
  const port = Number(process.env.PORT || 3000),
    host = process.env.HOST || "127.0.0.1";
  server.listen(port, host, () =>
    console.log(`DeadBrowse running at http://${host}:${port}`),
  );
  const shutdown = () =>
    server.close(() => {
      game.close();
      process.exit(0);
    });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
