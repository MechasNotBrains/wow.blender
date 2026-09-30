import fs from 'node:fs';
import path from 'node:path';

const MAP_KD_PREFIX = 'map_Kd ';

export interface FlattenResult {
  renamed: number;
  rewritten: number;
}

export const flat_name_resolve = (reference: string): string => {
  const segments = reference.split(/[\\/]+/).filter(segment => segment.length !== 0);
  return segments[segments.length - 1] ?? reference;
};

export const asset_textures_flatten = async (asset_dir: string, mtl_path: string): Promise<FlattenResult> => {
  const entries = await fs.promises.readdir(asset_dir);
  let renamed = 0;

  for (const entry of entries) {
    if (entry.includes('\\') === false)
      continue;

    const target = path.join(asset_dir, flat_name_resolve(entry));

    if (fs.existsSync(target))
      continue;

    await fs.promises.rename(path.join(asset_dir, entry), target);
    renamed++;
  }

  if (fs.existsSync(mtl_path) === false)
    return { renamed, rewritten: 0 };

  const source = await fs.promises.readFile(mtl_path, 'utf8');
  let rewritten = 0;

  const lines = source.split(/\r?\n/).map(line => {
    if (line.startsWith(MAP_KD_PREFIX) === false)
      return line;

    rewritten++;
    return MAP_KD_PREFIX + flat_name_resolve(line.slice(MAP_KD_PREFIX.length).trim());
  });

  await fs.promises.writeFile(mtl_path, lines.join('\n'));

  return { renamed, rewritten };
};
