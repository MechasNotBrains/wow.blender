import fs from 'node:fs';
import path from 'node:path';

import { CACHE_ROOT, PROJECT_ROOT, core_bootstrap, file_writers_drain, wow_module_load } from './wowexport.ts';
import { glb_from_obj_write } from './gltf.ts';
import { blend_batch_write } from './blend.ts';
import { asset_textures_flatten } from './normalize.ts';
import { asset_intermediates_prune } from './cleanup.ts';
import { m2_skin_patch } from './m2skin.ts';
import { creature_data_load, creature_variants_resolve } from './creature.ts';
import { item_data_load, item_variants_resolve } from './item.ts';
import { character_data_load, character_variants_resolve } from './character.ts';
import { variants_write } from './variants.ts';
import { glb_variants_inject } from './glbvariants.ts';
import { glb_render_apply, render_map_build } from './sided.ts';
import {
  asset_dir_resolve,
  asset_root_resolve,
  asset_slug_resolve,
  is_group_model,
  model_extension_resolve,
  mpq_prefix_strip
} from './categorize.ts';

import type {
  BufferWrapperModule,
  CreatureDisplay,
  ExportManifestEntry,
  LegacyExporter,
  LegacyExporterModule,
  M2LegacyExporterInstance,
  MpqInstallModule,
  WmoLegacyExporterModule
} from './types.ts';

const MODEL_EXTENSIONS = new Set(['.m2', '.wmo']);
const SKIP_ROOTS = new Set(['cameras', 'interface']);
const DEFAULT_BATCH = 25;
const DEFAULT_MAX_OBJ_MB = 64;
const BYTES_PER_MB = 1024 * 1024;

interface ShardSpec {
  index: number;
  count: number;
}

interface PendingAsset {
  relative_dir: string;
  bare_path: string;
  asset_dir: string;
  glb_path: string;
  blend_path: string;
  texture_count: number;
  renamed: number;
  rewritten: number;
  glb_bytes: number;
  variants: number;
  variant_meshes: number;
}

const argument_value_resolve = (args: string[], prefix: string): string | null => {
  for (const arg of args) {
    if (arg.startsWith(prefix))
      return arg.slice(prefix.length);
  }

  return null;
};

const shard_resolve = (args: string[]): ShardSpec => {
  const value = argument_value_resolve(args, '--shard=');

  if (value === null)
    return { index: 0, count: 1 };

  const parts = value.split('/');
  const index = Number.parseInt(parts[0] ?? '0', 10);
  const count = Number.parseInt(parts[1] ?? '1', 10);

  if (Number.isInteger(index) === false || Number.isInteger(count) === false || count < 1)
    return { index: 0, count: 1 };

  return { index: Math.max(index, 0) % count, count };
};

const skip_roots_resolve = (args: string[]): Set<string> => {
  const skipped = new Set(SKIP_ROOTS);
  const value = argument_value_resolve(args, '--skip=');

  if (value === null)
    return skipped;

  for (const name of value.split(',')) {
    const trimmed = name.trim().toLowerCase();

    if (trimmed.length !== 0)
      skipped.add(trimmed);
  }

  return skipped;
};

const max_obj_bytes_resolve = (args: string[]): number => {
  const value = argument_value_resolve(args, '--maxObjMB=');

  if (value === null)
    return DEFAULT_MAX_OBJ_MB * BYTES_PER_MB;

  const megabytes = Number.parseInt(value, 10);

  if (Number.isInteger(megabytes) === false || megabytes < 1)
    return DEFAULT_MAX_OBJ_MB * BYTES_PER_MB;

  return megabytes * BYTES_PER_MB;
};

const batch_size_resolve = (args: string[]): number => {
  const value = argument_value_resolve(args, '--batch=');

  if (value === null)
    return DEFAULT_BATCH;

  const size = Number.parseInt(value, 10);

  if (Number.isInteger(size) === false || size < 1)
    return DEFAULT_BATCH;

  return size;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(arg => arg.startsWith('--')));
  const positional = args.filter(arg => arg.startsWith('--') === false);

  const install_dir = positional[0];
  const out_dir = path.resolve(positional[1] ?? path.join(PROJECT_ROOT, 'out'));
  const pattern = positional[2]?.toLowerCase();
  const export_all = flags.has('--all');
  const keep_gltf = flags.has('--keepGLTF');
  const keep_obj = flags.has('--keepOBJ');
  const strict_textures = flags.has('--strictTextures');
  const resume = flags.has('--resume');
  const shard = shard_resolve(args);
  const skip_roots = skip_roots_resolve(args);
  const batch_size = batch_size_resolve(args);
  const max_obj_bytes = max_obj_bytes_resolve(args);

  if (install_dir === undefined) {
    process.stderr.write(
      'usage: bun src/export.ts <wow-install-dir> [out-dir] [name-filter]' +
      ' [--all] [--keepGLTF] [--keepOBJ] [--strictTextures]' +
      ' [--shard=i/n] [--batch=N] [--skip=root,root]\n'
    );
    process.exit(1);
  }

  const data_dir = path.join(path.resolve(install_dir), 'Data');

  const core = core_bootstrap({
    exportDirectory: out_dir,
    pathFormat: 'posix',
    modelsExportTextures: true,
    modelsExportAlpha: true,
    overwriteFiles: true,
    enableAbsoluteMTLPaths: false
  });

  const { MPQInstall } = wow_module_load<MpqInstallModule>('mpq/mpq-install');
  const BufferWrapper = wow_module_load<BufferWrapperModule>('buffer');
  const M2LegacyExporter = wow_module_load<LegacyExporterModule>('3D/exporters/M2LegacyExporter');
  const WMOLegacyExporter = wow_module_load<WmoLegacyExporterModule>('3D/exporters/WMOLegacyExporter');

  m2_skin_patch();

  process.stdout.write('scanning ' + data_dir + '\n');

  const mpq = new MPQInstall(data_dir);
  await mpq.loadInstall();
  core.view.mpq = mpq;

  await creature_data_load(mpq);

  const item_models = await item_data_load(mpq);
  process.stdout.write('item displays ' + item_models + '\n');

  const character_models = await character_data_load(mpq);
  process.stdout.write('character skins ' + character_models + '\n');

  process.stdout.write('build ' + (mpq.build_id ?? 'unknown') + '\n');
  process.stdout.write('archives ' + mpq.getArchiveCount() + '\n');
  process.stdout.write('files ' + mpq.getFileCount() + '\n');

  const models = mpq.getAllFiles().filter(display_path => {
    if (MODEL_EXTENSIONS.has(model_extension_resolve(display_path)) === false)
      return false;

    if (is_group_model(display_path))
      return false;

    if (skip_roots.has(asset_root_resolve(display_path)))
      return false;

    if (resume) {
      const blend_path = path.join(
        out_dir,
        asset_dir_resolve(display_path),
        asset_slug_resolve(display_path) + '.blend'
      );

      if (fs.existsSync(blend_path))
        return false;
    }

    if (pattern === undefined)
      return true;

    return mpq_prefix_strip(display_path).toLowerCase().includes(pattern);
  });

  const shard_models = shard.count === 1
    ? models
    : models.filter((_, index) => index % shard.count === shard.index);

  process.stdout.write('models ' + shard_models.length + ' of ' + models.length +
    ' (shard ' + shard.index + '/' + shard.count + ', batch ' + batch_size + ')\n');

  if (flags.has('--list')) {
    for (const display_path of shard_models)
      process.stdout.write('PENDING ' + mpq_prefix_strip(display_path) + '\n');

    mpq.close();
    return;
  }

  WMOLegacyExporter.clearCache();

  let exported = 0;
  let failed = 0;

  const pending: PendingAsset[] = [];
  const manifest_path = path.join(CACHE_ROOT, 'batch_' + String(shard.index) + '.json');

  const pending_flush = async (): Promise<void> => {
    if (pending.length === 0)
      return;

    const entries = pending.map(asset => ({ glb: asset.glb_path, blend: asset.blend_path }));
    const batch = await blend_batch_write(entries, manifest_path);

    for (const asset of pending) {
      const blend_bytes = batch.sizes.get(asset.blend_path);

      if (blend_bytes === undefined) {
        failed++;
        process.stderr.write('FAIL ' + asset.bare_path + ': blender produced no blend\n');
        continue;
      }

      const pruned = await asset_intermediates_prune(asset.asset_dir, keep_gltf, keep_obj);

      exported++;

      process.stdout.write(
        asset.relative_dir + '  ' + asset.bare_path +
        '  tex ' + asset.texture_count +
        '  flat ' + asset.renamed + '/' + asset.rewritten +
        '  var ' + asset.variants + '/' + asset.variant_meshes +
        '  glb ' + asset.glb_bytes + 'b' +
        '  blend ' + blend_bytes + 'b' +
        '  pruned ' + pruned.removed + '/' + pruned.bytes + 'b\n'
      );
    }

    pending.length = 0;
  };

  for (const display_path of shard_models) {
    const bare_path = mpq_prefix_strip(display_path);
    const relative_dir = asset_dir_resolve(display_path);
    const slug = asset_slug_resolve(display_path);
    const asset_dir = path.join(out_dir, relative_dir);
    const obj_path = path.join(asset_dir, slug + '.obj');

    process.stdout.write('START ' + bare_path + '\n');

    try {
      const raw = mpq.getFile(display_path);

      if (raw === null)
        throw new Error('not present in any archive');

      fs.mkdirSync(asset_dir, { recursive: true });

      const data = new BufferWrapper(Buffer.from(raw));
      const extension = model_extension_resolve(display_path);
      const file_manifest: ExportManifestEntry[] = [];

      let exporter: LegacyExporter;
      let m2_exporter: M2LegacyExporterInstance | null = null;
      let displays: CreatureDisplay[] = [];
      let skin_textures: string[] = [];

      if (extension === '.wmo') {
        exporter = new WMOLegacyExporter(data, bare_path, mpq);
      } else {
        m2_exporter = new M2LegacyExporter(data, bare_path, mpq) as M2LegacyExporterInstance;
        displays = creature_variants_resolve(bare_path);

        if (displays.length === 0)
          displays = item_variants_resolve(bare_path);

        if (displays.length === 0)
          displays = character_variants_resolve(bare_path);

        skin_textures = displays[0]?.textures ?? [];

        if (skin_textures.length !== 0)
          m2_exporter.setSkinTextures(skin_textures);

        exporter = m2_exporter;
      }

      await exporter.exportAsOBJ(obj_path, null, file_manifest);
      await file_writers_drain();

      if (fs.existsSync(obj_path) === false)
        throw new Error('exporter produced no obj');

      const texture_count = file_manifest.filter(entry => entry.type === 'PNG').length;

      if (texture_count === 0 && strict_textures)
        throw new Error('no textures resolved');

      if (texture_count === 0)
        process.stderr.write('WARN ' + bare_path + ': no textures resolved\n');

      const obj_bytes = fs.statSync(obj_path).size;

      if (obj_bytes > max_obj_bytes) {
        throw new Error(
          'obj too large for conversion: ' + Math.round(obj_bytes / BYTES_PER_MB) +
          'MB exceeds ' + Math.round(max_obj_bytes / BYTES_PER_MB) + 'MB'
        );
      }

      const mtl_path = obj_path.replace(/\.obj$/i, '.mtl');
      const flattened = await asset_textures_flatten(asset_dir, mtl_path);
      const glb = await glb_from_obj_write(obj_path);

      if (m2_exporter?.m2 != null) {
        const render = await render_map_build(m2_exporter.m2);
        await glb_render_apply(glb.glb_path, render);
      }

      const written = await variants_write(asset_dir, mpq, displays);
      const injected = written === null ? null : await glb_variants_inject(glb.glb_path, written.manifest);

      pending.push({
        relative_dir,
        bare_path,
        asset_dir,
        glb_path: glb.glb_path,
        blend_path: glb.glb_path.replace(/\.glb$/i, '.blend'),
        texture_count,
        renamed: flattened.renamed,
        rewritten: flattened.rewritten,
        glb_bytes: injected === null ? glb.byte_length : injected.byte_length,
        variants: injected === null ? 0 : injected.variants,
        variant_meshes: injected === null ? 0 : injected.meshes
      });

      if (pending.length >= batch_size)
        await pending_flush();
    } catch (error) {
      failed++;
      const reason = error instanceof Error ? error.message : String(error);
      process.stderr.write('FAIL ' + bare_path + ': ' + reason + '\n');
    }

    if (export_all === false)
      break;
  }

  await pending_flush();

  mpq.close();

  process.stdout.write('exported ' + exported + ', failed ' + failed + '\n');
};

await main();
