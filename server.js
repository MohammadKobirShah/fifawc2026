/**
 * Zero-dependency static file server for Saoodify Player.
 *
 * WHY THIS EXISTS:
 *   The app builds to a single self-contained `dist/index.html` (plus the
 *   KaiOS manifest + icon). It is a *static* site — there is no Node runtime
 *   needed at request time. If you deploy it as a Render "Web Service",
 *   the Start Command must keep a process alive; `npm run build` exits after
 *   building, which causes "Application exited early".
 *
 *   Set the Web Service Start Command to:  node server.js
 *
 *   (A Render "Static Site" is even simpler — no server needed at all.
 *    See README.md "Deploy to Render".)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webapp": "application/x-web-app-manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    // Guard against path traversal.
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stat) => {
      let finalPath = filePath;
      if (err || !stat.isFile()) {
        // SPA / fallback: serve index.html for unknown routes.
        finalPath = path.join(ROOT, "index.html");
      }
      const ext = path.extname(finalPath).toLowerCase();
      fs.readFile(finalPath, (e, data) => {
        if (e) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control":
            ext === ".html" ? "no-cache" : "public, max-age=86400",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        });
        res.end(data);
      });
    });
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Saoodify Player running →  http://0.0.0.0:${PORT}`);
});
