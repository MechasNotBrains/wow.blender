import { wow_module_load } from './wowexport.ts';

import type { CreatureDbModule, CreatureDisplay, MpqInstall } from './types.ts';

let creature_db: CreatureDbModule | null = null;

export const creature_data_load = async (mpq: MpqInstall): Promise<void> => {
  creature_db = wow_module_load<CreatureDbModule>('db/caches/DBCreaturesLegacy');
  await creature_db.initializeCreatureData(mpq, mpq.build_id);
};

export const creature_variants_resolve = (model_path: string): CreatureDisplay[] => {
  if (creature_db === null)
    return [];

  const displays = creature_db.getCreatureDisplaysByPath(model_path);

  if (displays === undefined)
    return [];

  const unique: CreatureDisplay[] = [];
  const seen = new Set<string>();

  for (const display of displays) {
    if (display.textures.length === 0)
      continue;

    const key = display.textures.join('|').toLowerCase();

    if (seen.has(key))
      continue;

    seen.add(key);
    unique.push(display);
  }

  return unique;
};

export const creature_skins_resolve = (model_path: string): string[] | null => {
  const variants = creature_variants_resolve(model_path);
  const first = variants[0];

  if (first === undefined)
    return null;

  return first.textures;
};
