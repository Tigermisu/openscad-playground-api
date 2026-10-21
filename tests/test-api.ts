import { createServer } from '../src/server/server.ts';
import { wasmEngine } from '../src/server/engine/wasm-engine.ts';
import http from 'node:http';

async function runTestSuite() {
  console.log('🧪 Starting OpenSCAD REST API Automated Test Suite...\n');

  // Initialize engine
  await wasmEngine.initialize();

  const app = createServer();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Test server running at ${baseUrl}\n`);

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      const t0 = performance.now();
      await fn();
      const t1 = performance.now();
      console.log(`  ✅ PASS: ${name} (${(t1 - t0).toFixed(1)}ms)`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}\n     ${err.message}`);
      failed++;
    }
  }

  // Test 1: Health check
  await test('GET /api/health returns engine info & libraries', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Expected status: ok, got ${data.status}`);
    if (!data.availableLibraries.includes('BOSL2')) {
      throw new Error(`Expected BOSL2 in availableLibraries, got: ${JSON.stringify(data.availableLibraries)}`);
    }
  });

  // Test 2: Check syntax & parameter extraction
  await test('POST /api/check parses parameters from valid script', async () => {
    const res = await fetch(`${baseUrl}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
// Customizer Parameters
diameter = 25; // [10:50]
height = 40; // [20:100]
cylinder(d=diameter, h=height, $fn=32);
echo("Test Echo Output");
        `,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const data = await res.json();
    if (!data.valid) throw new Error(`Expected valid: true`);
    if (data.parameters.length < 2) {
      throw new Error(`Expected at least 2 parameters, got ${data.parameters.length}`);
    }
    const paramNames = data.parameters.map((p: any) => p.name);
    if (!paramNames.includes('diameter') || !paramNames.includes('height')) {
      throw new Error(`Expected diameter and height in parameters: ${JSON.stringify(paramNames)}`);
    }
    if (!data.echoes.some((e: string) => e.includes('Test Echo Output'))) {
      throw new Error(`Expected echo message in echoes: ${JSON.stringify(data.echoes)}`);
    }
  });

  // Test 3: Check syntax error reporting
  await test('POST /api/check reports syntax errors on invalid code', async () => {
    const res = await fetch(`${baseUrl}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'cube([10, 20 // missing closing bracket',
      }),
    });
    const data = await res.json();
    if (data.valid) throw new Error('Expected valid: false for broken syntax');
    if (data.errors.length === 0 && !data.stderr.includes('syntax error')) {
      throw new Error('Expected syntax error in errors or stderr');
    }
  });

  // Test 4: Render basic STL model
  await test('POST /api/render generates binary STL', async () => {
    const res = await fetch(`${baseUrl}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'cube([10, 20, 30], center=true);',
        format: 'stl',
        binary: false,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Expected success: true');
    if (!data.data || data.data.length === 0) throw new Error('Expected non-empty base64 data');
    const buf = Buffer.from(data.data, 'base64');
    if (buf.length < 100) throw new Error(`STL buffer too small (${buf.length} bytes)`);
  });

  // Test 5: Render with BOSL2 library
  await test('POST /api/render executes BOSL2 cuboid with Manifold backend', async () => {
    const res = await fetch(`${baseUrl}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
include <BOSL2/std.scad>
cuboid([30, 20, 10], rounding=3, teardrop=true);
        `,
        format: 'stl',
        binary: true,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`Expected substantial STL for rounded cuboid, got ${buf.length} bytes`);
  });

  // Test 6: Render 2D SVG
  await test('POST /api/render exports 2D SVG', async () => {
    const res = await fetch(`${baseUrl}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'square([40, 20], center=true);',
        format: 'svg',
        binary: true,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const svgText = await res.text();
    if (!svgText.includes('<svg') || !svgText.includes('</svg>')) {
      throw new Error(`Expected valid SVG tags in output: ${svgText.substring(0, 100)}`);
    }
  });

  // Test 7: Render Single Visual Preview (PNG/SVG)
  await test('POST /api/preview renders visual inspection image', async () => {
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'cylinder(r1=20, r2=10, h=30, $fn=48);',
        angle: 'iso',
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`Expected success: true, got error: ${data.error}`);
    if (!data.dataUrl || !data.dataUrl.startsWith('data:image/')) {
      throw new Error(`Expected dataUrl starting with data:image/, got: ${data.dataUrl?.substring(0, 30)}`);
    }
  });

  // Test 8: Render Multi-Angle Previews (ISO, Top, Front, Right)
  await test('POST /api/preview/multi generates all 4 inspection perspectives', async () => {
    const res = await fetch(`${baseUrl}/api/preview/multi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'cube([15, 25, 35], center=true);',
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Expected success: true');
    const angles = Object.keys(data.views);
    for (const expected of ['iso', 'top', 'front', 'right']) {
      if (!angles.includes(expected)) {
        throw new Error(`Expected ${expected} in multi-angle views: ${JSON.stringify(angles)}`);
      }
      if (!data.views[expected].success) {
        throw new Error(`Expected ${expected} view success: true`);
      }
    }
  });

  // Clean shutdown
  server.close();

  console.log('\n=======================================');
  console.log(`🏁 Test Summary: ${passed} Passed, ${failed} Failed`);
  console.log('=======================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
