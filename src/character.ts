import { wow_module_load } from './wowexport.ts';

import type {
  BufferWrapperModule,
  CreatureDisplay,
  DbcReaderModule,
  DbcRow,
  MpqInstall
} from './types.ts';

const RACE_IDS: Record<string, number> = {
  human: 1,
  orc: 2,
  dwarf: 3,
  nightelf: 4,
  scourge: 5,
  tauren: 6,
  gnome: 7,
  troll: 8,
  goblin: 9,
  bloodelf: 10,
  draenei: 11
};

const CHAR_SECTIONS_PATH = 'DBFilesClient\\CharSections.dbc';
const CHAR_SECTIONS_NAME = 'CharSections.dbc';

const SECTION_BASE_SKIN = 0;

const skin_sections = new Map<string, CreatureDisplay[]>();

let loaded = false;

const number_resolve = (row: DbcRow, ...names: string[]): number => {
  for (const name of names) {
    const value = row[name];

    if (typeof value === 'number')
      return value;
  }

  return -1;
};

const text_resolve = (row: DbcRow, name: string, index: number): string => {
  const value = row[name];

  if (Array.isArray(value)) {
    const entry: unknown = value[index];

    if (typeof entry === 'string' && entry.length !== 0)
      return entry;

    return '';
  }

  if (typeof value === 'string' && index === 0)
    return value;

  return '';
};

const section_key_resolve = (race_id: number, sex_id: number): string => {
  return String(race_id) + '|' + String(sex_id);
};

const sections_load = async (mpq: MpqInstall): Promise<void> => {
  const raw = mpq.getFile(CHAR_SECTIONS_PATH);

  if (raw === null)
    return;

  const DBCReader = wow_module_load<DbcReaderModule>('db/DBCReader');
  const BufferWrapper = wow_module_load<BufferWrapperModule>('buffer');

  const reader = new DBCReader(CHAR_SECTIONS_NAME, mpq.build_id ?? '');
  await reader.parse(new BufferWrapper(Buffer.from(raw)));

  for (const [id, row] of reader.getAllRows()) {
    const section = number_resolve(row, 'BaseSection', 'SectionType');

    if (section !== SECTION_BASE_SKIN)
      continue;

    const race_id = number_resolve(row, 'RaceID', 'Race');
    const sex_id = number_resolve(row, 'SexID', 'Sex');

    if (race_id < 0 || sex_id < 0)
      continue;

    const texture = text_resolve(row, 'TextureName', 0);

    if (texture.length === 0)
      continue;

    const key = section_key_resolve(race_id, sex_id);
    const entries = skin_sections.get(key) ?? [];

    entries.push({ id, textures: [texture] });
    skin_sections.set(key, entries);
  }
};

export const character_data_load = async (mpq: MpqInstall): Promise<number> => {
  if (loaded)
    return skin_sections.size;

  loaded = true;

  await sections_load(mpq);

  return skin_sections.size;
};

export const character_variants_resolve = (model_path: string): CreatureDisplay[] => {
  const segments = model_path.toLowerCase().split(/[\\/]+/);

  if (segments[0] !== 'character')
    return [];

  const race = segments[1] ?? '';
  const sex = segments[2] ?? '';

  const race_id = RACE_IDS[race];

  if (race_id === undefined)
    return [];

  const sex_id = sex === 'female' ? 1 : 0;
  const entries = skin_sections.get(section_key_resolve(race_id, sex_id));

  if (entries === undefined)
    return [];

  const unique: CreatureDisplay[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const key = entry.textures.join('|').toLowerCase();

    if (seen.has(key))
      continue;

    seen.add(key);
    unique.push(entry);
  }

  return unique;
};
