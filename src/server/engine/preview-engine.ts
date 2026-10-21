import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { wasmEngine } from './wasm-engine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

export interface CameraPreset {
  name: string;
  camera: string; // "translate_x,y,z,rot_x,y,z,dist"
  description: string;
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  iso: {
    name: 'iso',
    camera: '0,0,0,55,0,25,120',
    description: 'Isometric diagonal view showing 3D perspective',
  },
  top: {
    name: 'top',
    camera: '0,0,0,0,0,0,100',
    description: 'Top-down orthogonal/plan view (looking down Z-axis)',
  },
  front: {
    name: 'front',
    camera: '0,0,0,90,0,0,100',
    description: 'Front elevation view (facing XZ plane)',
  },
  right: {
    name: 'right',
    camera: '0,0,0,90,0,90,100',
    description: 'Right side elevation view (facing YZ plane)',
  },
  left: {
    name: 'left',
    camera: '0,0,0,90,0,-90,100',
    description: 'Left side elevation view',
  },
  bottom: {
    name: 'bottom',
    camera: '0,0,0,180,0,0,100',
    description: 'Bottom view (looking up towards Z=0)',
  },
};

export interface PreviewOptions {
  code: string;
  angle?: 'iso' | 'top' | 'front' | 'right' | 'left' | 'bottom' | string;
  camera?: string;
  imgsize?: [number, number];
  colorscheme?: string;
  projection?: 'ortho' | 'perspective';
  vars?: Record<string, any>;
  includeLibraries?: boolean;
}

export interface PreviewResult {
  success: boolean;
  angle: string;
  contentType: 'image/png' | 'image/svg+xml';
  data: Buffer;
  base64DataUrl: string;
  elapsedMs: number;
  engineUsed: 'native' | 'wasm_svg';
  error?: string;
}

export class PreviewEngine {
  private nativeOpenSCADPath: string | null = null;
  private checkedNative: boolean = false;

  public async getNativePath(): Promise<string | null> {
    if (this.checkedNative) return this.nativeOpenSCADPath;

    const candidates = [
      process.env.OPENSCAD_PATH,
      '/Users/jaquezmusule/.gemini/antigravity/bin/openscad',
      '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD',
      '/usr/local/bin/openscad',
      '/usr/bin/openscad',
    ];

    for (const cand of candidates) {
      if (!cand) continue;
      try {
        await fs.access(cand);
        this.nativeOpenSCADPath = cand;
        break;
      } catch {
        // Not found at this path
      }
    }

    this.checkedNative = true;
    return this.nativeOpenSCADPath;
  }

  public async renderPreview(options: PreviewOptions): Promise<PreviewResult> {
    const t0 = performance.now();
    const nativeBinary = await this.getNativePath();
    const angle = options.angle ?? 'iso';
    const preset = CAMERA_PRESETS[angle];
    const cameraArg = options.camera ?? (preset ? preset.camera : CAMERA_PRESETS.iso.camera);
    const [width, height] = options.imgsize ?? [800, 600];
    const colorscheme = options.colorscheme ?? 'Sunset';
    const projection = options.projection === 'ortho' ? 'o' : 'p';

    if (nativeBinary) {
      try {
        const result = await this.renderNativePreview(nativeBinary, {
          code: options.code,
          camera: cameraArg,
          width,
          height,
          colorscheme,
          projection,
          vars: options.vars,
        });

        const elapsedMs = performance.now() - t0;
        return {
          success: true,
          angle,
          contentType: 'image/png',
          data: result,
          base64DataUrl: `data:image/png;base64,${result.toString('base64')}`,
          elapsedMs,
          engineUsed: 'native',
        };
      } catch (err: any) {
        console.warn(`[PreviewEngine] Native preview failed: ${err.message}. Falling back to WASM projection.`);
      }
    }

    // Fallback: WASM 2D projection / SVG
    try {
      const svgResult = await this.renderWasmSvgFallback(options.code, options.vars);
      const elapsedMs = performance.now() - t0;
      return {
        success: true,
        angle,
        contentType: 'image/svg+xml',
        data: svgResult,
        base64DataUrl: `data:image/svg+xml;base64,${svgResult.toString('base64')}`,
        elapsedMs,
        engineUsed: 'wasm_svg',
      };
    } catch (err: any) {
      return {
        success: false,
        angle,
        contentType: 'image/png',
        data: Buffer.alloc(0),
        base64DataUrl: '',
        elapsedMs: performance.now() - t0,
        engineUsed: 'wasm_svg',
        error: err.message,
      };
    }
  }

  public async renderMultiAnglePreviews(options: Omit<PreviewOptions, 'angle'>): Promise<{
    views: Record<string, PreviewResult>;
    elapsedMs: number;
  }> {
    const t0 = performance.now();
    const angles = ['iso', 'top', 'front', 'right'] as const;
    const views: Record<string, PreviewResult> = {};

    await Promise.all(
      angles.map(async (angle) => {
        views[angle] = await this.renderPreview({
          ...options,
          angle,
        });
      })
    );

    return {
      views,
      elapsedMs: performance.now() - t0,
    };
  }

  private async renderNativePreview(
    binPath: string,
    params: {
      code: string;
      camera: string;
      width: number;
      height: number;
      colorscheme: string;
      projection: string;
      vars?: Record<string, any>;
    }
  ): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openscad-preview-'));
    const inputScad = path.join(tmpDir, 'model.scad');
    const outputPng = path.join(tmpDir, 'preview.png');

    try {
      await fs.writeFile(inputScad, params.code, 'utf8');

      // Add library search path if needed
      const projectLibsDir = path.resolve(__dirname, '../../../libs');
      const args: string[] = [
        inputScad,
        '-o',
        outputPng,
        `--imgsize=${params.width},${params.height}`,
        `--camera=${params.camera}`,
        '--autocenter',
        '--viewall',
        `--colorscheme=${params.colorscheme}`,
        `--projection=${params.projection}`,
        '--preview',
      ];

      if (params.vars) {
        for (const [k, v] of Object.entries(params.vars)) {
          args.push(`-D${k}=${JSON.stringify(v)}`);
        }
      }

      await execFileAsync(binPath, args, {
        env: {
          ...process.env,
          OPENSCADPATH: projectLibsDir,
        },
        timeout: 30000,
      });

      return await fs.readFile(outputPng);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async renderWasmSvgFallback(code: string, vars?: Record<string, any>): Promise<Buffer> {
    // Wrap model in projection(cut=false) to get a 2D outline SVG
    const wrappedCode = `
projection(cut=false) {
  ${code}
}
`;
    const res = await wasmEngine.run({
      code: wrappedCode,
      outputFormat: 'svg',
      vars,
    });

    if (res.outputData) {
      return res.outputData;
    }

    throw new Error('Fallback SVG generation produced no output');
  }
}

export const previewEngine = new PreviewEngine();
