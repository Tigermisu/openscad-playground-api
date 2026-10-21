import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API router
  app.use('/api', apiRouter);

  // Serve static files from compiled web playground if dist/ exists
  if (fs.existsSync(DIST_DIR)) {
    console.log(`[Server] Serving static OpenSCAD Web Playground from ${DIST_DIR}`);
    app.use(express.static(DIST_DIR));
  } else {
    const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
    if (fs.existsSync(PUBLIC_DIR)) {
      app.use(express.static(PUBLIC_DIR));
    }
  }

  // Interactive documentation & agent playground landing page at /docs
  app.get('/docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenSCAD Agent REST API</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #222; background: #fafafa; }
    h1, h2 { color: #0f172a; }
    .badge { display: inline-block; background: #2563eb; color: #fff; padding: 4px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    code, pre { font-family: "JetBrains Mono", Menlo, monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { padding: 14px; overflow-x: auto; }
    .method { font-weight: bold; padding: 3px 8px; border-radius: 4px; margin-right: 8px; font-size: 0.85em; }
    .post { background: #dbeafe; color: #1e40af; }
    .get { background: #dcfce7; color: #166534; }
    .endpoint { font-weight: bold; font-family: monospace; }
    button { background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; }
    button:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <h1>OpenSCAD Agent REST API <span class="badge">v1.0.0</span></h1>
  <p>Headless OpenSCAD execution and multi-angle 3D rendering service with pre-loaded BOSL2 and Manifold backend, designed for AI coding agents and CLI/web pipelines.</p>

  <div class="card">
    <h2>⚡ Quick Status</h2>
    <p>Web Playground UI: <a href="/" target="_blank">Open Playground</a> | OpenAPI Spec: <a href="/api/openapi.json" target="_blank">/api/openapi.json</a> | Health: <a href="/api/health" target="_blank">/api/health</a></p>
  </div>

  <div class="card">
    <h2>Endpoints</h2>

    <p><span class="method post">POST</span><span class="endpoint">/api/check</span></p>
    <p>Check syntax, extract customizer parameters, and get compilation diagnostics.</p>
    <pre>curl -X POST http://localhost:3000/api/check \\
  -H "Content-Type: application/json" \\
  -d '{"code": "radius = 10; // [5:30]\\ncylinder(r=radius, h=20, $fn=32);"}'</pre>

    <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">

    <p><span class="method post">POST</span><span class="endpoint">/api/render</span></p>
    <p>Render model to <b>STL</b>, <b>3MF</b>, <b>OFF</b>, <b>DXF</b>, <b>SVG</b>, or <b>CSG</b>. Set <code>binary: true</code> or <code>Accept: model/stl</code> to download directly.</p>
    <pre>curl -X POST http://localhost:3000/api/render \\
  -H "Content-Type: application/json" \\
  -d '{"code": "include &lt;BOSL2/std.scad&gt;\\ncuboid([20,30,10], rounding=3);", "format": "stl", "binary": true}' \\
  -o model.stl</pre>

    <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">

    <p><span class="method post">POST</span><span class="endpoint">/api/preview</span></p>
    <p>Render a single visual preview image (PNG) from angles: <code>iso</code>, <code>top</code>, <code>front</code>, <code>right</code>, <code>bottom</code>.</p>
    <pre>curl -X POST http://localhost:3000/api/preview \\
  -H "Content-Type: application/json" \\
  -d '{"code": "cube([10,20,30], center=true);", "angle": "iso", "binary": true}' \\
  -o preview.png</pre>

    <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">

    <p><span class="method post">POST</span><span class="endpoint">/api/preview/multi</span></p>
    <p>Render 4 standard multi-angle inspection views (ISO, Top, Front, Right) in one roundtrip for multimodal agent vision validation.</p>
    <pre>curl -X POST http://localhost:3000/api/preview/multi \\
  -H "Content-Type: application/json" \\
  -d '{"code": "cylinder(r=15, h=30);"}'</pre>
  </div>
</body>
</html>
    `);
  });

  return app;
}
