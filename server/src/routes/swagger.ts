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

// ============================================================
// 1. CHEMIN DE LA SPEC OPENAPI (Phase 3)
// ============================================================
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

// ============================================================
// 2. ROUTE POUR LA SPEC BRUTE
// ============================================================
router.get("/openapi.yaml", (req, res) => {
  res.type("application/yaml").send(YAML);
});

// ============================================================
// 3. PAGE SWAGGER UI
// ============================================================

// Script d'initialisation servi depuis 'self' (autorise par la CSP sans
// 'unsafe-inline') : la config SwaggerUIBundle vit dans un fichier séparé.
const INIT_JS = `window.onload = () => {
  window.ui = SwaggerUIBundle({
    url: "/api-docs/openapi.yaml",
    dom_id: "#swagger-ui",
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis],
    persistAuthorization: true,
    // Configuration pour supporter les URLs OBP (sans /api/v1)
    requestInterceptor: (req) => {
      if (req.url.includes("/obp/v3.1.0/") && req.url.includes("/api/v1/obp/")) {
        req.url = req.url.replace("/api/v1/obp/", "/obp/");
      }
      return req;
    },
  });
};
`;

router.get("/swagger-ui-init.js", (req, res) => {
  res.type("application/javascript").send(INIT_JS);
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
  <script src="/api-docs/swagger-ui-init.js"></script>
</body>
</html>`;
  res.type("text/html").send(html);
});

export default router;
