import { wow_module_load } from './wowexport.ts';

import type {
  BufferWrapperModule,
  CreatureDisplay,
  DbcReaderModule,
  DbcRow,
  MpqInstall
} from './types.ts';

const ITEM_DISPLAY_PATH = 'DBFilesClient\\ItemDisplayInfo.dbc';
const ITEM_DISPLAY_NAME = 'ItemDisplayInfo.dbc';

const FIELD_MODEL_NAME = 1;
const FIELD_MODEL_TEXTURE = 3;

interface ItemTextureEntry {
  id: number;
  texture: string;
}

const item_textures = new Map<string, ItemTextureEntry[]>();
let loaded = false;

const text_resolve = (row: DbcRow, name: string, index: number, field: number): string => {
  const named = row[name];

  if (Array.isArray(named)) {
    const value: unknown = named[index];

    if (typeof value === 'string' && value.length !== 0)
      return value;
  }

  if (typeof named === 'string' && named.length !== 0 && index === 0)
    return named;

  const fallback = row['field_' + String(field)];

  if (typeof fallback === 'string' && fallback.length !== 0)
    return fallback;

  return '';
};

const model_key_resolve = (model_name: string): string => {
  const base = model_name.split(/[\\/]+/).pop() ?? model_name;
  return base.replace(/\.(m2|mdx|mdl)$/i, '').toLowerCase();
};

export const item_data_load = async (mpq: MpqInstall): Promise<number> => {
  if (loaded)
    return item_textures.size;

  loaded = true;

  const raw = mpq.getFile(ITEM_DISPLAY_PATH);

  if (raw === null)
    return 0;

  const DBCReader = wow_module_load<DbcReaderModule>('db/DBCReader');
  const BufferWrapper = wow_module_load<BufferWrapperModule>('buffer');

  const reader = new DBCReader(ITEM_DISPLAY_NAME, mpq.build_id ?? '');
  await reader.parse(new BufferWrapper(Buffer.from(raw)));

  for (const [id, row] of reader.getAllRows()) {
    const primary_texture = text_resolve(row, 'ModelTexture', 0, FIELD_MODEL_TEXTURE);

    for (let slot = 0; slot < 2; slot++) {
      const model_name = text_resolve(row, 'ModelName', slot, FIELD_MODEL_NAME + slot);
      const slot_texture = text_resolve(row, 'ModelTexture', slot, FIELD_MODEL_TEXTURE + slot);
      const texture = slot_texture.length !== 0 ? slot_texture : primary_texture;

      if (model_name.length === 0 || texture.length === 0)
        continue;

      const key = model_key_resolve(model_name);
      const entries = item_textures.get(key) ?? [];

      entries.push({ id, texture });
      item_textures.set(key, entries);
    }
  }

  return item_textures.size;
};

const entries_lookup = (key: string): ItemTextureEntry[] | undefined => {
  const direct = item_textures.get(key);

  if (direct !== undefined)
    return direct;

  const cut = key.lastIndexOf('_');

  if (cut <= 0)
    return undefined;

  return item_textures.get(key.slice(0, cut));
};

export const item_variants_resolve = (model_path: string): CreatureDisplay[] => {
  const key = model_key_resolve(model_path);
  const entries = entries_lookup(key);

  if (entries === undefined)
    return [];

  const segments = model_path.split(/[\\/]+/);
  const directory = segments.slice(0, -1).join('/');

  const unique: CreatureDisplay[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const texture_key = entry.texture.toLowerCase();

    if (seen.has(texture_key))
      continue;

    seen.add(texture_key);
    unique.push({ id: entry.id, textures: [directory + '/' + entry.texture + '.blp'] });
  }

  return unique;
};
