// server/src/routes/swagger.ts
//
// Swagger UI sans dépendance npm : sert la spec OpenAPI et une page HTML
// qui charge swagger-ui-dist depuis un CDN.
//
// Montage dans server.ts :
//   app.use(
//     "/api-docs",
//     (await import("./server/src/routes/swagger.js")).default,
//   );
//
// Accès :
//   GET /api-docs             -> Swagger UI
//   GET /api-docs/openapi.yaml -> spec brute

import express from "express";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Chemin candidats pour la spec (dossier courant, racine du repo, phase3)
const specCandidates = [
  path.join(__dirname, "openapi.yaml"),
  path.join(__dirname, "../../../openapi.yaml"),
  path.join(__dirname, "../../../../openapi.yaml"),
  path.join(process.cwd(), "openapi.yaml"),
];

const specPath =
  specCandidates.find((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  }) || specCandidates[0];

const YAML = readFileSync(specPath, "utf-8");

router.get("/openapi.yaml", (req, res) => {
  res.type("application/yaml").send(YAML);
});

router.get("/", (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>piYès API — Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; }
    body { margin: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: "/api-docs/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        persistAuthorization: true,
      });
    };
  </script>
</body>
</html>`;
  res.type("text/html").send(html);
});

export default router;
