import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import { join, resolve } from "node:path";

import { AppModule } from "./app.module";

const DEFAULT_PORT = 4000;
const projectRoot = resolve(__dirname, "..", "..");

dotenv.config({
  path: join(projectRoot, ".env"),
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  const openApiPath = join(projectRoot, "docs", "openapi.yaml");

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.get("/openapi.yaml", (_request: Request, response: Response) => {
    response.sendFile(openApiPath);
  });

  expressApp.get("/docs", (_request: Request, response: Response) => {
    response.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Medislot API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f3f6fb; }
      .topbar { display: none; }
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

  await app.listen(port);

  console.log(`Medislot backend listening on http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/docs`);
}

void bootstrap();
