import { transact, ConflictError } from "./store.js";
import { register, snapshot, action, GameError } from "./game.js";
import html from "../public/index.html";
import javascript from "../public/app.js";
import css from "../public/styles.css";
const security = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...security, "Content-Type": "application/json" },
  });
}
async function identity(request) {
  // These headers are supplied and authenticated by the private Sites dispatcher.
  const user = request.headers.get("oai-authenticated-user-id");
  if (!user) throw new GameError("Sign in with ChatGPT to continue.", 401);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(user),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function body(request) {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    throw new GameError("Send JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new GameError("Invalid JSON.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4096) {
      await reader.cancel();
      throw new GameError("Request too large.", 413);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(data));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    throw new GameError("Invalid JSON.");
  }
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url),
        path = url.pathname;
      if (!path.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method))
          return json(405, { error: "Method not allowed." });
        const asset = {
          "/": [html, "text/html"],
          "/app.js": [javascript, "text/javascript"],
          "/styles.css": [css, "text/css"],
        }[path];
        if (!asset) return json(404, { error: "Not found." });
        return new Response(request.method === "HEAD" ? null : asset[0], {
          headers: {
            ...security,
            "Content-Type": asset[1] + "; charset=utf-8",
          },
        });
      }
      const id = await identity(request);
      if (
        request.method === "POST" &&
        request.headers.get("Origin") !== url.origin
      )
        throw new GameError("Request origin rejected.", 403);
      const now = Date.now();
      if (path === "/api/state" && request.method === "GET")
        return json(
          200,
          await transact(env.DB, (w) =>
            w.players[id]
              ? {
                  hosted: true,
                  csrf: w.players[id].csrf,
                  state: snapshot(w, id, now),
                }
              : { hosted: true, needsProfile: true },
          ),
        );
      if (path === "/api/register" && request.method === "POST") {
        const data = await body(request);
        return json(
          200,
          await transact(env.DB, (w) => {
            const state = register(w, id, data.name, now);
            return { hosted: true, csrf: w.players[id].csrf, state };
          }),
        );
      }
      if (path === "/api/logout" && request.method === "POST")
        return json(
          200,
          await transact(env.DB, (w) => {
            if (request.headers.get("X-CSRF-Token") !== w.players[id]?.csrf)
              throw new GameError("Session verification failed.", 403);
            return { redirect: "/signout-with-chatgpt?return_to=/" };
          }),
        );
      if (path === "/api/action" && request.method === "POST") {
        const input = await body(request);
        return json(
          200,
          await transact(env.DB, (w) => {
            if (
              !w.players[id] ||
              request.headers.get("X-CSRF-Token") !== w.players[id].csrf
            )
              throw new GameError(
                "Session verification failed. Refresh and try again.",
                403,
              );
            return { state: action(w, id, input, now) };
          }),
        );
      }
      return json(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof GameError)
        return json(error.status, { error: error.message });
      if (error instanceof ConflictError)
        return json(409, { error: error.message });
      console.error("Game request failed", error);
      return json(503, {
        error:
          "The world is temporarily unavailable. Your last saved progress is safe; please try again.",
      });
    }
  },
};
