import { createServer } from "node:http";

import { logInfo } from "./log.js";

export interface HealthState {
  gatewayConnected: () => boolean;
  lastEventAt: () => string | null;
}

export function startHealthServer(state: HealthState): void {
  const port = Number(process.env.PORT);
  if (!Number.isFinite(port) || port <= 0) {
    return;
  }
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && (path === "/health" || path === "/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          gatewayConnected: state.gatewayConnected(),
          lastEventAt: state.lastEventAt(),
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  server.listen(port, "0.0.0.0", () => logInfo("health server listening", { port }));
}
