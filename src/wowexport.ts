import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

interface MmapModule {
  create_virtual_file(): never;
  release_virtual_files(): void;
}

interface WriteStreamLike {
  end(): void;
  once(event: string, listener: () => void): void;
}

interface FileWriterLike {
  stream: WriteStreamLike;
  close(): void;
}

interface FileWriterModule {
  prototype: FileWriterLike;
}

import type { WowConfig, WowCore, InstallTypeModule } from './types.ts';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(SRC_DIR, '..');
export const WOWEXPORT_ROOT = path.join(PROJECT_ROOT, 'lib', 'wowexport');
export const WOWEXPORT_SRC = path.join(WOWEXPORT_ROOT, 'src', 'js');
export const CACHE_ROOT = path.join(PROJECT_ROOT, 'bin', '.cache', 'wowexport');

const DEFAULT_CONFIG_PATH = path.join(WOWEXPORT_ROOT, 'src', 'default_config.jsonc');

const module_require = createRequire(path.join(WOWEXPORT_SRC, 'anchor.cjs'));

const mmap_stub: MmapModule = {
  create_virtual_file: () => {
    throw new Error('mmap native addon unavailable; CASC listfile paths are unsupported headlessly');
  },
  release_virtual_files: () => {}
};

const mmap_stub_install = (): void => {
  const mmap_path = path.join(WOWEXPORT_SRC, 'mmap.js');

  module_require.cache[mmap_path] = {
    id: mmap_path,
    path: path.dirname(mmap_path),
    filename: mmap_path,
    loaded: true,
    children: [],
    paths: [],
    parent: null,
    exports: mmap_stub
  } as unknown as NodeModule;
};

const pending_writes: Promise<void>[] = [];

const file_writer_patch = (): void => {
  const file_writer = module_require(path.join(WOWEXPORT_SRC, 'file-writer')) as FileWriterModule;
  const original_close = file_writer.prototype.close;

  file_writer.prototype.close = function close_tracked(this: FileWriterLike): void {
    const settled = new Promise<void>(resolve => {
      this.stream.once('finish', resolve);
      this.stream.once('error', resolve);
    });

    pending_writes.push(settled);
    original_close.call(this);
  };
};

export const file_writers_drain = async (): Promise<void> => {
  while (pending_writes.length !== 0)
    await Promise.all(pending_writes.splice(0, pending_writes.length));
};

let globals_ready = false;

export const globals_install = (): void => {
  if (globals_ready)
    return;

  fs.mkdirSync(CACHE_ROOT, { recursive: true });

  globalThis.BUILD_RELEASE = false;

  globalThis.nw = {
    __dirname: WOWEXPORT_SRC,
    App: {
      dataPath: CACHE_ROOT,
      argv: [],
      manifest: { version: '0.2.19', flavour: 'headless', guid: 'headless' }
    },
    Shell: {
      openItem: () => {},
      openExternal: () => {}
    }
  };

  if (globalThis.requestAnimationFrame === undefined) {
    globalThis.requestAnimationFrame = (callback: AnimationFrameCallback): number => {
      setTimeout(() => callback(Date.now()), 0);
      return 0;
    };
  }

  mmap_stub_install();
  file_writer_patch();

  globals_ready = true;
};

export const wow_module_load = <ModuleType>(relative_path: string): ModuleType => {
  globals_install();
  return module_require(path.join(WOWEXPORT_SRC, relative_path)) as ModuleType;
};

export const default_config_read = (): WowConfig => {
  const raw = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
  const lines = raw.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//'));
  return JSON.parse(lines.join('\n')) as WowConfig;
};

export const core_bootstrap = (config_overrides: Partial<WowConfig> = {}): WowCore => {
  const core = wow_module_load<WowCore>('core');
  const install_type = wow_module_load<InstallTypeModule>('install-type');

  core.view = core.makeNewView();
  core.view.installType = install_type.MPQ;
  core.view.config = { ...default_config_read(), ...config_overrides };

  core.showLoadingScreen = () => {};
  core.hideLoadingScreen = () => {};

  core.progressLoadingScreen = async (text?: string): Promise<void> => {
    if (text === undefined)
      return;

    process.stdout.write('  ' + text + '\n');
  };

  core.setToast = (toast_type: string, message: string): void => {
    if (toast_type === 'progress')
      return;

    process.stdout.write('[' + toast_type + '] ' + message + '\n');
  };

  return core;
};
