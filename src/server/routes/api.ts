import { Router, Request, Response } from 'express';
import { wasmEngine } from '../engine/wasm-engine.ts';
import { previewEngine, CAMERA_PRESETS } from '../engine/preview-engine.ts';

export const apiRouter = Router();

// Health check
apiRouter.get('/health', async (_req: Request, res: Response) => {
  const nativePath = await previewEngine.getNativePath();
  const libraries = wasmEngine.getAvailableLibraries();

  res.json({
    status: 'ok',
    engine: 'OpenSCAD WebAssembly (WASM)',
    version: '2025.03.25',
    manifoldEnabled: true,
    nativeRendererAvailable: nativePath !== null,
    nativePath,
    availableLibraries: libraries,
    cameraPresets: Object.keys(CAMERA_PRESETS),
  });
});

// Check syntax and extract customizer parameters
apiRouter.post('/check', async (req: Request, res: Response) => {
  try {
    const { code, vars, features } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "code" parameter in request body.' });
      return;
    }

    const result = await wasmEngine.run({
      code,
      outputFormat: 'param',
      vars,
      features,
    });

    res.json({
      valid: result.exitCode === 0 && result.errors.length === 0,
      exitCode: result.exitCode,
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      parameters: result.parameters || [],
      echoes: result.echoes,
      warnings: result.warnings,
      errors: result.errors,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Render 3D / 2D model (STL, 3MF, OFF, DXF, SVG, CSG)
apiRouter.post('/render', async (req: Request, res: Response) => {
  try {
    const {
      code,
      format = 'stl',
      vars,
      features = ['manifold'],
      binary = false,
      extraFiles,
    } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "code" parameter in request body.' });
      return;
    }

    const validFormats = ['stl', 'binstl', 'asciistl', '3mf', 'off', 'dxf', 'svg', 'csg'];
    if (!validFormats.includes(format.toLowerCase())) {
      res.status(400).json({
        error: `Invalid format "${format}". Supported formats are: ${validFormats.join(', ')}`,
      });
      return;
    }

    const result = await wasmEngine.run({
      code,
      outputFormat: format.toLowerCase() as any,
      vars,
      features,
      extraFiles,
    });

    if (!result.success || !result.outputData) {
      res.status(422).json({
        error: 'OpenSCAD render failed',
        exitCode: result.exitCode,
        errors: result.errors,
        warnings: result.warnings,
        echoes: result.echoes,
        stderr: result.stderr,
      });
      return;
    }

    const mimeTypes: Record<string, string> = {
      stl: 'model/stl',
      binstl: 'model/stl',
      asciistl: 'model/stl',
      '3mf': 'model/3mf',
      off: 'text/plain',
      dxf: 'image/vnd.dxf',
      svg: 'image/svg+xml',
      csg: 'text/plain',
    };

    const isBinaryRequested =
      binary === true ||
      req.query.binary === 'true' ||
      req.headers.accept?.includes('model/') ||
      req.headers.accept?.includes('application/octet-stream');

    if (isBinaryRequested) {
      const extension = format.toLowerCase().includes('stl') ? 'stl' : format.toLowerCase();
      res.setHeader('Content-Type', mimeTypes[format.toLowerCase()] || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="model.${extension}"`);
      res.send(result.outputData);
      return;
    }

    // JSON response with Base64 data
    res.json({
      success: true,
      format: format.toLowerCase(),
      fileSize: result.outputData.length,
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      data: result.outputData.toString('base64'),
      echoes: result.echoes,
      warnings: result.warnings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /render for direct URL / curl downloading
apiRouter.get('/render', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const format = (req.query.format as string) || 'stl';

  if (!code) {
    res.status(400).send('Query parameter "code" is required.');
    return;
  }

  // Forward to POST handler logic
  req.body = {
    code,
    format,
    binary: true,
  };
  (apiRouter as any).handle(req, res);
});

// Visual preview rendering (Single angle)
apiRouter.post('/preview', async (req: Request, res: Response) => {
  try {
    const {
      code,
      angle = 'iso',
      camera,
      imgsize = [800, 600],
      colorscheme = 'Sunset',
      projection = 'perspective',
      vars,
      binary = false,
    } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "code" parameter in request body.' });
      return;
    }

    const result = await previewEngine.renderPreview({
      code,
      angle,
      camera,
      imgsize,
      colorscheme,
      projection,
      vars,
    });

    if (!result.success) {
      res.status(422).json({ error: result.error || 'Preview render failed' });
      return;
    }

    const isBinaryRequested =
      binary === true ||
      req.query.binary === 'true' ||
      req.headers.accept?.includes('image/png') ||
      req.headers.accept?.includes('image/svg+xml');

    if (isBinaryRequested) {
      res.setHeader('Content-Type', result.contentType);
      res.send(result.data);
      return;
    }

    res.json({
      success: true,
      angle: result.angle,
      contentType: result.contentType,
      engineUsed: result.engineUsed,
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      dataUrl: result.base64DataUrl,
      base64: result.data.toString('base64'),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /preview for <img> tags and curl
apiRouter.get('/preview', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const angle = (req.query.angle as string) || 'iso';

  if (!code) {
    res.status(400).send('Query parameter "code" is required.');
    return;
  }

  try {
    const result = await previewEngine.renderPreview({
      code,
      angle,
      imgsize: [800, 600],
    });

    if (!result.success) {
      res.status(422).send(result.error);
      return;
    }

    res.setHeader('Content-Type', result.contentType);
    res.send(result.data);
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// Multi-angle visual inspection (ISO, Top, Front, Right) in one roundtrip
apiRouter.post('/preview/multi', async (req: Request, res: Response) => {
  try {
    const { code, imgsize = [600, 450], colorscheme = 'Sunset', vars } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "code" parameter in request body.' });
      return;
    }

    const multi = await previewEngine.renderMultiAnglePreviews({
      code,
      imgsize,
      colorscheme,
      vars,
    });

    const views: Record<string, any> = {};
    for (const [angle, preview] of Object.entries(multi.views)) {
      views[angle] = {
        success: preview.success,
        contentType: preview.contentType,
        engineUsed: preview.engineUsed,
        dataUrl: preview.base64DataUrl,
        base64: preview.data.toString('base64'),
      };
    }

    res.json({
      success: true,
      totalElapsedMs: Number(multi.elapsedMs.toFixed(2)),
      views,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List pre-installed libraries and modules
apiRouter.get('/libraries', (_req: Request, res: Response) => {
  const libs = wasmEngine.getAvailableLibraries();
  const details: Record<string, string[]> = {};

  for (const lib of libs) {
    details[lib] = wasmEngine.getLibraryFiles(lib);
  }

  res.json({
    libraries: libs,
    files: details,
  });
});

// OpenAPI 3.1 specification for AI tool calling
apiRouter.get('/openapi.json', (_req: Request, res: Response) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'OpenSCAD REST API & Playground Service',
      version: '1.0.0',
      description: 'On-demand OpenSCAD compilation, mesh rendering, syntax validation, and visual multi-angle inspection API for AI agents and developer tooling.',
    },
    paths: {
      '/api/health': {
        get: {
          summary: 'Health check and runtime capabilities',
          responses: {
            '200': { description: 'Status and capabilities' },
          },
        },
      },
      '/api/check': {
        post: {
          summary: 'Check OpenSCAD syntax, extract customizer parameters, and capture compiler diagnostics',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code'],
                  properties: {
                    code: { type: 'string', description: 'OpenSCAD source script' },
                    vars: { type: 'object', description: 'Variable overrides (-D)' },
                    features: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Syntax validation and parameter schema' },
          },
        },
      },
      '/api/render': {
        post: {
          summary: 'Render 3D model or 2D drawing to specified format (stl, 3mf, off, dxf, svg, csg)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code'],
                  properties: {
                    code: { type: 'string', description: 'OpenSCAD source script' },
                    format: {
                      type: 'string',
                      enum: ['stl', '3mf', 'off', 'dxf', 'svg', 'csg'],
                      default: 'stl',
                    },
                    vars: { type: 'object' },
                    features: { type: 'array', items: { type: 'string' }, default: ['manifold'] },
                    binary: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Rendered mesh data' },
          },
        },
      },
      '/api/preview': {
        post: {
          summary: 'Render visual preview image (PNG/SVG) from specified camera angle',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code'],
                  properties: {
                    code: { type: 'string' },
                    angle: {
                      type: 'string',
                      enum: ['iso', 'top', 'front', 'right', 'left', 'bottom'],
                      default: 'iso',
                    },
                    camera: { type: 'string' },
                    imgsize: { type: 'array', items: { type: 'integer' }, default: [800, 600] },
                    colorscheme: { type: 'string', default: 'Sunset' },
                    binary: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Preview image' },
          },
        },
      },
      '/api/preview/multi': {
        post: {
          summary: 'Render multi-angle visual inspection images (iso, top, front, right) in parallel',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['code'],
                  properties: {
                    code: { type: 'string' },
                    imgsize: { type: 'array', items: { type: 'integer' }, default: [600, 450] },
                    colorscheme: { type: 'string', default: 'Sunset' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Multi-angle preview images' },
          },
        },
      },
    },
  });
});
