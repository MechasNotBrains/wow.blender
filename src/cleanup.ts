import fs from 'node:fs';
import path from 'node:path';

const OBJ_EXTENSIONS = new Set(['.obj', '.mtl', '.json', '.png']);
const GLTF_EXTENSIONS = new Set(['.glb', '.gltf', '.bin']);

export interface PruneResult {
  removed: number;
  bytes: number;
}

const prune_decide = (extension: string, keep_gltf: boolean, keep_obj: boolean): boolean => {
  if (OBJ_EXTENSIONS.has(extension))
    return keep_obj === false;

  if (GLTF_EXTENSIONS.has(extension))
    return keep_gltf === false;

  return false;
};

export const asset_intermediates_prune = async (
  asset_dir: string,
  keep_gltf: boolean,
  keep_obj: boolean
): Promise<PruneResult> => {
  if (keep_gltf && keep_obj)
    return { removed: 0, bytes: 0 };

  const entries = await fs.promises.readdir(asset_dir);
  let removed = 0;
  let bytes = 0;

  for (const entry of entries) {
    if (prune_decide(path.extname(entry).toLowerCase(), keep_gltf, keep_obj) === false)
      continue;

    const target = path.join(asset_dir, entry);
    const stat = await fs.promises.stat(target);

    await fs.promises.unlink(target);

    bytes += stat.size;
    removed++;
  }

  return { removed, bytes };
};
