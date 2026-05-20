"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_PORT = 4000;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const projectRoot = node_path_1.default.resolve(__dirname, "..");
const openApiPath = node_path_1.default.join(projectRoot, "docs", "openapi.yaml");
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    app.get("/health", (_request, response) => {
        response.status(200).json({ status: "ok" });
    });
    app.get("/openapi.yaml", (_request, response) => {
        response.sendFile(openApiPath);
    });
    app.get("/docs", (_request, response) => {
        response.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Medislot API Docs</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
    <style>
      body {
        margin: 0;
        background: #f4f7fb;
      }
      .topbar {
        display: none;
      }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        window.SwaggerUIBundle({
          url: "/openapi.yaml",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [window.SwaggerUIBundle.presets.apis],
        });
      };
    </script>
  </body>
</html>`);
    });
    return app;
}
if (require.main === module) {
    const app = createApp();
    app.listen(port, () => {
        console.log(`Medislot API listening on http://localhost:${port}`);
        console.log(`Swagger UI available at http://localhost:${port}/docs`);
    });
}
