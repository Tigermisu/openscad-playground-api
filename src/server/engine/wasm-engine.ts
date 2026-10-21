import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is 3 levels up from src/server/engine
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const WASM_JS_PATH = path.join(PROJECT_ROOT, 'libs/openscad-wasm/openscad.js');
const WASM_BINARY_PATH = path.join(PROJECT_ROOT, 'libs/openscad-wasm/openscad.wasm');
const LIBS_DIR = path.join(PROJECT_ROOT, 'libs');

export interface OpenSCADInvocationOptions {
  code: string;
  extraFiles?: Record<string, string>;
  outputFormat?: 'stl' | 'binstl' | 'asciistl' | '3mf' | 'off' | 'dxf' | 'svg' | 'csg' | 'param';
  vars?: Record<string, any>;
  features?: string[];
  backend?: 'manifold' | 'cgal';
  customArgs?: string[];
}

export interface ParameterInfo {
  name: string;
  type: string;
  initial?: any;
  min?: number;
  max?: number;
  step?: number;
  group?: string;
  options?: any[];
}

export interface OpenSCADExecutionResult {
  success: boolean;
  exitCode: number;
  elapsedMs: number;
  stdout: string;
  stderr: string;
  echoes: string[];
  warnings: string[];
  errors: string[];
  outputData?: Buffer;
  parameters?: ParameterInfo[];
}

export class OpenSCADEngine {
  private wasmBinary: Buffer | null = null;
  private OpenSCADModule: any = null;
  private preloadedLibraries: Map<string, Buffer> = new Map();
  private initialized: boolean = false;

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[OpenSCADEngine] Initializing WASM runtime & preloading libraries...');
    const t0 = performance.now();

    // 1. Read wasm binary
    this.wasmBinary = await fs.readFile(WASM_BINARY_PATH);

    // 2. Import OpenSCAD JS module
    const imported = await import(WASM_JS_PATH);
    this.OpenSCADModule = imported.default || imported;

    // 3. Scan and preload libraries into memory
    await this.preloadLibraries();

    this.initialized = true;
    const t1 = performance.now();
    console.log(`[OpenSCADEngine] Ready in ${(t1 - t0).toFixed(1)}ms! Preloaded ${this.preloadedLibraries.size} library files.`);
  }

  private async preloadLibraries(): Promise<void> {
    const supportedLibs = ['BOSL2', 'BOSL', 'MCAD', 'NopSCADlib', 'funcutils', 'FunctionalOpenSCAD', 'YAPP_Box', 'boltsparts', 'UB.scad'];

    for (const libName of supportedLibs) {
      const libPath = path.join(LIBS_DIR, libName);
      try {
        const stat = await fs.stat(libPath);
        if (stat.isDirectory()) {
          await this.scanDirectory(libPath, `/libraries/${libName}`);
        }
      } catch {
        // Library directory might not exist if build:libs was partial
      }
    }
  }

  private async scanDirectory(diskDir: string, virtualDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(diskDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullDiskPath = path.join(diskDir, entry.name);
        const virtualPath = `${virtualDir}/${entry.name}`;

        if (entry.isDirectory()) {
          // Skip git / test folders
          if (entry.name === '.git' || entry.name === 'tests' || entry.name === 'docs') continue;
          await this.scanDirectory(fullDiskPath, virtualPath);
        } else if (entry.name.endsWith('.scad') || entry.name.endsWith('.json') || entry.name.endsWith('.ttf')) {
          const content = await fs.readFile(fullDiskPath);
          this.preloadedLibraries.set(virtualPath, content);
        }
      }
    } catch (err: any) {
      console.warn(`[OpenSCADEngine] Error scanning directory ${diskDir}: ${err.message}`);
    }
  }

  public getAvailableLibraries(): string[] {
    const libs = new Set<string>();
    for (const vpath of this.preloadedLibraries.keys()) {
      const parts = vpath.split('/');
      if (parts.length > 2 && parts[1] === 'libraries') {
        libs.add(parts[2]);
      }
    }
    return Array.from(libs);
  }

  public getLibraryFiles(libName: string): string[] {
    const prefix = `/libraries/${libName}/`;
    const files: string[] = [];
    for (const vpath of this.preloadedLibraries.keys()) {
      if (vpath.startsWith(prefix)) {
        files.push(vpath.substring(prefix.length));
      }
    }
    return files;
  }

  public async run(options: OpenSCADInvocationOptions): Promise<OpenSCADExecutionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const start = performance.now();
    let stdout = '';
    let stderr = '';

    const inst = await this.OpenSCADModule({
      noInitialRun: true,
      wasmBinary: this.wasmBinary,
      noExitRuntime: true,
      print: (text: string) => {
        stdout += text + '\n';
      },
      printErr: (text: string) => {
        stderr += text + '\n';
      },
    });

    // Configure search paths
    inst.ENV['OPENSCADPATH'] = '/libraries';
    inst.FS.mkdir('/libraries');

    // Populate preloaded libraries into MEMFS
    for (const [vpath, content] of this.preloadedLibraries.entries()) {
      const parent = path.posix.dirname(vpath);
      if (!inst.FS.analyzePath(parent).exists) {
        inst.FS.mkdirTree(parent);
      }
      inst.FS.writeFile(vpath, content);
    }

    // Write extra files if provided
    if (options.extraFiles) {
      for (const [filename, content] of Object.entries(options.extraFiles)) {
        const vpath = filename.startsWith('/') ? filename : `/${filename}`;
        const parent = path.posix.dirname(vpath);
        if (!inst.FS.analyzePath(parent).exists) {
          inst.FS.mkdirTree(parent);
        }
        inst.FS.writeFile(vpath, content);
      }
    }

    // Write main input file
    const mainInputFile = '/main.scad';
    inst.FS.writeFile(mainInputFile, options.code);

    // Format output filename
    const format = options.outputFormat ?? 'stl';
    const isParamExport = format === 'param';
    const outFilename = isParamExport ? '/out.json' : `/out.${format === 'binstl' || format === 'asciistl' ? 'stl' : format}`;

    const args: string[] = [mainInputFile, '-o', outFilename];

    if (isParamExport) {
      args.push('--export-format=param');
    } else {
      if (format === 'binstl') {
        args.push('--export-format=binstl');
      } else if (format === 'asciistl') {
        args.push('--export-format=asciistl');
      }
    }

    // Backend selection
    const backend = options.backend ?? 'manifold';
    args.push(`--backend=${backend}`);

    // Variable overrides (-D)
    if (options.vars) {
      for (const [key, val] of Object.entries(options.vars)) {
        const formatted = this.formatScadValue(val);
        args.push(`-D${key}=${formatted}`);
      }
    }

    // Features
    if (options.features && options.features.length > 0) {
      for (const feat of options.features) {
        args.push(`--enable=${feat}`);
      }
    }

    // Custom arguments
    if (options.customArgs) {
      args.push(...options.customArgs);
    }

    let exitCode = 0;
    try {
      exitCode = inst.callMain(args);
    } catch (e: any) {
      // In Emscripten, callMain may throw on exit or error
      if (typeof e === 'number' && inst.formatException) {
        stderr += `\n${inst.formatException(e)}`;
      } else if (e?.message) {
        stderr += `\n${e.message}`;
      }
    }

    const elapsedMs = performance.now() - start;

    // Parse messages
    const { echoes, warnings, errors } = this.parseLogs(stdout, stderr);

    // Read output data if generated
    let outputData: Buffer | undefined;
    let parameters: ParameterInfo[] | undefined;

    if (inst.FS.analyzePath(outFilename).exists) {
      const raw = inst.FS.readFile(outFilename);
      outputData = Buffer.from(raw);

      if (isParamExport) {
        try {
          const jsonText = outputData.toString('utf8');
          const parsed = JSON.parse(jsonText);
          parameters = parsed.parameters || [];
        } catch (e: any) {
          warnings.push(`Failed to parse customizer parameters JSON: ${e.message}`);
        }
      }
    }

    const success = exitCode === 0 && (outputData !== undefined || isParamExport);

    return {
      success,
      exitCode,
      elapsedMs,
      stdout,
      stderr,
      echoes,
      warnings,
      errors,
      outputData,
      parameters,
    };
  }

  private formatScadValue(val: any): string {
    if (typeof val === 'string') {
      return `"${val.replace(/"/g, '\\"')}"`;
    } else if (Array.isArray(val)) {
      return `[${val.map((v) => this.formatScadValue(v)).join(', ')}]`;
    } else if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    } else {
      return `${val}`;
    }
  }

  private parseLogs(stdout: string, stderr: string): { echoes: string[]; warnings: string[]; errors: string[] } {
    const combined = `${stdout}\n${stderr}`;
    const lines = combined.split('\n');

    const echoes: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('ECHO:')) {
        echoes.push(line.substring(5).trim());
      } else if (line.startsWith('WARNING:')) {
        warnings.push(line.substring(8).trim());
      } else if (line.startsWith('ERROR:') || line.includes('Parser error:')) {
        errors.push(line);
      }
    }

    return { echoes, warnings, errors };
  }
}

// Global singleton instance
export const wasmEngine = new OpenSCADEngine();
