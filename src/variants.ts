import fs from 'node:fs';
import path from 'node:path';

import { wow_module_load } from './wowexport.ts';
import { flat_name_resolve } from './normalize.ts';

import type {
  BlpFileModule,
  BufferWrapperModule,
  CreatureDisplay,
  MpqInstall
} from './types.ts';

export interface VariantEntry {
  display_id: number;
  textures: string[];
}

export interface VariantManifest {
  base: VariantEntry | null;
  variants: VariantEntry[];
}

export interface VariantWriteResult {
  manifest_path: string;
  manifest: VariantManifest;
  variant_count: number;
  texture_count: number;
}

const MANIFEST_NAME = 'variants.json';

const png_name_resolve = (blp_path: string): string => {
  return flat_name_resolve(blp_path).replace(/\.blp$/i, '.png');
};

export const variants_write = async (
  asset_dir: string,
  mpq: MpqInstall,
  displays: CreatureDisplay[]
): Promise<VariantWriteResult | null> => {
  if (displays.length < 2)
    return null;

  const BlpFile = wow_module_load<BlpFileModule>('casc/blp');
  const BufferWrapper = wow_module_load<BufferWrapperModule>('buffer');

  const entries: VariantEntry[] = [];
  let texture_count = 0;

  for (const display of displays) {
    const names: string[] = [];

    for (const blp_path of display.textures) {
      const png_name = png_name_resolve(blp_path);
      const out_path = path.join(asset_dir, png_name);

      if (fs.existsSync(out_path)) {
        names.push(png_name);
        continue;
      }

      const raw = mpq.getFile(blp_path);

      if (raw === null)
        continue;

      try {
        const blp = new BlpFile(new BufferWrapper(Buffer.from(raw)));
        await blp.saveToPNG(out_path, 0b1111);

        names.push(png_name);
        texture_count++;
      } catch {
        continue;
      }
    }

    if (names.length === 0)
      continue;

    entries.push({ display_id: display.id, textures: names });
  }

  if (entries.length < 2)
    return null;

  const manifest: VariantManifest = {
    base: entries[0] ?? null,
    variants: entries.slice(1)
  };

  const manifest_path = path.join(asset_dir, MANIFEST_NAME);
  await fs.promises.writeFile(manifest_path, JSON.stringify(manifest, null, 2));

  return {
    manifest_path,
    manifest,
    variant_count: manifest.variants.length,
    texture_count
  };
};
