# OpenSCAD Playground & Agent REST API Service

> **Fork of [openscad/openscad-playground](https://github.com/openscad/openscad-playground)** augmented with a high-performance **REST API** tailored for AI coding agents, CLI tools, and web automation to validate, compile, inspect, and render OpenSCAD models on-demand.

[![Test Suite](https://img.shields.io/badge/tests-8%20passed-brightgreen.svg)](#testing)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-blue.svg)](http://localhost:3000/api/openapi.json)
[![Backend: Manifold](https://img.shields.io/badge/backend-Manifold%20(Fast)-orange.svg)](https://github.com/elalish/manifold)
[![Pre-loaded Libraries](https://img.shields.io/badge/libraries-BOSL2%20%7C%20MCAD%20%7C%20NopSCADlib-purple.svg)](#supported-libraries)

---

## 🌟 What's New in this Fork

- 🤖 **Agent-First REST API**: Complete HTTP endpoints for OpenSCAD syntax checking, parameter extraction, multi-format mesh export, and visual preview generation.
- ⚡ **Zero-Dependency Headless WASM Execution**: Runs in Node.js via OpenSCAD WebAssembly (WASM 2025.03) with the **Manifold backend** for instant (<30ms) geometry evaluation.
- 📦 **Pre-loaded Libraries**: Built-in in-memory virtual filesystem mounts for **BOSL2**, **BOSL**, **MCAD**, **NopSCADlib**, **YAPP_Box**, **funcutils**, and **UB.scad** — `include <BOSL2/std.scad>` works out of the box!
- 📸 **Multi-Angle Visual Previews**: Dedicated endpoints for single-angle and 4-view simultaneous orthographic inspection (ISO, Top, Front, Right) designed for multimodal LLM vision feedback loops.
- 🖥️ **Dual Engine Support**: Uses native OpenSCAD CLI when available on the host for accelerated offscreen camera rendering, with seamless WASM SVG fallback for pure containerized environments.
- 🎨 **Hybrid UI + API**: Retains the full Monaco editor and `<model-viewer>` interactive web playground at `/`, while serving the API at `/api/` and documentation at `/docs`.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** >= 22 (Node 22 LTS recommended)

### 2. Install & Start Server
```bash
# Clone and enter directory
cd openscad-playground-api

# Install dependencies
npm install

# Download WASM & clone standard libraries (BOSL2, MCAD, etc.)
npm run build:all

# Start the REST API & Web Playground server (default port 3000)
npm start
```

Open your browser:
- 📖 **Interactive API Documentation**: [http://localhost:3000/docs](http://localhost:3000/docs)
- 🔍 **OpenAPI 3.1 Schema**: [http://localhost:3000/api/openapi.json](http://localhost:3000/api/openapi.json)
- 🖥️ **Web Playground**: [http://localhost:3000/](http://localhost:3000/)
- ❤️ **Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

## 📡 REST API Reference

### 1. `POST /api/check`
Syntax checking, error diagnostics, and customizer parameter extraction.

```bash
curl -X POST http://localhost:3000/api/check \
  -H "Content-Type: application/json" \
  -d '{
    "code": "radius = 15; // [5:50]\ncylinder(r=radius, h=30, $fn=48);\necho(\"Compiled OK\");"
  }'
```

**Response:**
```json
{
  "valid": true,
  "exitCode": 0,
  "elapsedMs": 28.5,
  "parameters": [
    { "name": "radius", "type": "number", "initial": 15, "min": 5, "max": 50, "step": 1 }
  ],
  "echoes": ["Compiled OK"],
  "warnings": [],
  "errors": []
}
```

---

### 2. `POST /api/render`
Render 3D mesh or 2D drawing to **STL**, **3MF**, **OFF**, **DXF**, **SVG**, or **CSG**.

```bash
# Download binary STL directly (using BOSL2!)
curl -X POST http://localhost:3000/api/render \
  -H "Content-Type: application/json" \
  -d '{
    "code": "include <BOSL2/std.scad>\ncuboid([30, 20, 10], rounding=3, teardrop=true);",
    "format": "stl",
    "binary": true
  }' \
  -o rounded_box.stl
```

Or receive JSON with Base64:
```bash
curl -X POST http://localhost:3000/api/render \
  -H "Content-Type: application/json" \
  -d '{"code": "cube([10, 20, 30]);", "format": "stl"}'
```

---

### 3. `POST /api/preview`
Generate a visual preview image (PNG) from a chosen camera angle (`iso`, `top`, `front`, `right`, `bottom`, `left`).

```bash
# Download ISO preview image directly
curl -X POST http://localhost:3000/api/preview \
  -H "Content-Type: application/json" \
  -d '{
    "code": "cylinder(r1=20, r2=10, h=40, $fn=32);",
    "angle": "iso",
    "binary": true
  }' \
  -o preview.png
```

---

### 4. `POST /api/preview/multi`
Generate 4 standard orthographic inspection views (**ISO**, **Top**, **Front**, **Right**) in a single call for multimodal vision agents.

```bash
curl -X POST http://localhost:3000/api/preview/multi \
  -H "Content-Type: application/json" \
  -d '{
    "code": "include <BOSL2/std.scad>\nscrew(\"M5x20\", head=\"hex\");",
    "imgsize": [600, 450]
  }'
```

**Response:**
```json
{
  "success": true,
  "totalElapsedMs": 340.2,
  "views": {
    "iso": { "dataUrl": "data:image/png;base64,...", "contentType": "image/png" },
    "top": { "dataUrl": "data:image/png;base64,...", "contentType": "image/png" },
    "front": { "dataUrl": "data:image/png;base64,...", "contentType": "image/png" },
    "right": { "dataUrl": "data:image/png;base64,...", "contentType": "image/png" }
  }
}
```

---

### 5. `GET /api/libraries`
Returns list of all pre-installed libraries and modules available for `include <...>` / `use <...>`.

---

## 🐍 Python Client Example for AI Agents

```python
import requests
import base64

API_URL = "http://localhost:3000/api"

def check_code(scad_code: str):
    res = requests.post(f"{API_URL}/check", json={"code": scad_code})
    return res.json()

def render_stl(scad_code: str, output_path: str):
    res = requests.post(
        f"{API_URL}/render",
        json={"code": scad_code, "format": "stl", "binary": True}
    )
    res.raise_for_status()
    with open(output_path, "wb") as f:
        f.write(res.content)
    print(f"Saved {output_path} ({len(res.content)} bytes)")

def get_multi_angle_previews(scad_code: str):
    res = requests.post(f"{API_URL}/preview/multi", json={"code": scad_code})
    data = res.json()
    return {angle: view["dataUrl"] for angle, view in data["views"].items()}

if __name__ == "__main__":
    code = """
    include <BOSL2/std.scad>
    diff()
      cuboid([40, 40, 20], rounding=4)
        tag("remove") attach(TOP) hole(d=15, h=25);
    """
    check = check_code(code)
    print("Syntax Valid:", check["valid"])
    if check["valid"]:
        render_stl(code, "part.stl")
        previews = get_multi_angle_previews(code)
        print("Generated views:", list(previews.keys()))
```

---

## 🧪 Testing

Run the automated integration test suite:
```bash
npm test
```

This verifies:
1. Health endpoint & WASM initialization
2. Customizer parameter parsing
3. Syntax error detection
4. Binary STL mesh generation
5. Complex BOSL2 + Manifold evaluation
6. 2D SVG export
7. Single-angle visual rendering
8. 4-angle parallel inspection previews

---

## 🐳 Docker Deployment

Run with Docker Compose:
```bash
docker compose up --build
```
Or build manually:
```bash
docker build -t openscad-agent-api .
docker run -p 3000:3000 openscad-agent-api
```

---

## Original Web Playground Features
The original client-side web application remains fully accessible at `http://localhost:3000/`:
- Automatic preview on edit (F5) and full rendering (F6).
- Customizer controls panel.
- Monaco code editor with syntax highlighting and autocompletion.
- Interactive `<model-viewer>` 3D viewport.
