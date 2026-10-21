import { createServer } from './server.ts';
import { wasmEngine } from './engine/wasm-engine.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('==================================================');
  console.log('   Starting OpenSCAD REST API & Playground Server ');
  console.log('==================================================');

  // Pre-initialize WASM engine & pre-load libraries (BOSL2, etc.)
  await wasmEngine.initialize();

  const app = createServer();

  app.listen(PORT, HOST, () => {
    console.log(`\n🚀 Server listening at http://${HOST}:${PORT}`);
    console.log(`📚 REST API Docs:        http://localhost:${PORT}/docs`);
    console.log(`🔍 OpenAPI Schema:       http://localhost:${PORT}/api/openapi.json`);
    console.log(`🖥️  Web Playground:       http://localhost:${PORT}/`);
    console.log(`❤️  Health Check:         http://localhost:${PORT}/api/health\n`);
  });
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
