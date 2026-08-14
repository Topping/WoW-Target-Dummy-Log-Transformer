import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT ?? "4173");
const requestedBasePath = process.env.PAGES_BASE_PATH ?? "/";
const basePath = `/${requestedBasePath.split("/").filter(Boolean).join("/")}${
  requestedBasePath === "/" ? "" : "/"
}`;
const basePathWithoutSlash = basePath === "/" ? "/" : basePath.slice(0, -1);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
]);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT: ${String(process.env.PORT)}`);
}

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === basePathWithoutSlash && basePath !== "/") {
      send(response, 301, "Redirecting to the repository-scoped site.\n", {
        Location: basePath,
      });
      return;
    }
    if (!requestUrl.pathname.startsWith(basePath)) {
      send(response, 404, "Not found.\n");
      return;
    }

    const requestedArtifactPath = decodeURIComponent(
      requestUrl.pathname.slice(basePath.length),
    );
    const relativeArtifactPath =
      requestedArtifactPath === "" ? "index.html" : requestedArtifactPath;
    const normalizedPath = normalize(relativeArtifactPath);
    if (
      normalizedPath === ".." ||
      normalizedPath.startsWith(`..${sep}`) ||
      normalizedPath.startsWith(sep)
    ) {
      send(response, 404, "Not found.\n");
      return;
    }

    const filePath = join(DIST, normalizedPath);
    const relativeToDist = relative(DIST, filePath);
    if (relativeToDist.startsWith("..") || relativeToDist === "") {
      send(response, 404, "Not found.\n");
      return;
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      send(response, 404, "Not found.\n");
      return;
    }
    const contentType = contentTypes.get(extname(filePath));
    if (contentType === undefined) {
      send(response, 415, "Unsupported artifact type.\n");
      return;
    }

    response.writeHead(200, {
      "Content-Length": fileStat.size,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error instanceof URIError) {
      send(response, 400, "Invalid URL encoding.\n");
      return;
    }
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      send(response, 404, "Not found.\n");
      return;
    }
    send(response, 500, "Static artifact server error.\n");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Serving dist at http://127.0.0.1:${String(port)}${basePath}\n`,
  );
});
