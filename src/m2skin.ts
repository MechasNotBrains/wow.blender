import { wow_module_load } from './wowexport.ts';

import type {
  BufferWrapperModule,
  ExportHelperInstance,
  ExportManifestEntry,
  M2Skin,
  M2SubMesh,
  M2TextureUnit,
  MpqInstall,
  WowBuffer
} from './types.ts';

const M2_VER_WOTLK = 264;
const SKIN_MAGIC = 'SKIN';

interface SkinSource {
  file_path: string;
  mpq: MpqInstall;
}

interface M2LoaderLike {
  data: WowBuffer;
  version: number;
  skins: M2Skin[];
}

interface M2LoaderClass {
  prototype: {
    getSkin(this: M2LoaderLike, index: number): Promise<M2Skin | undefined>;
  };
}

interface M2ExporterLike {
  data: WowBuffer;
  filePath: string;
  mpq: MpqInstall;
}

interface M2ExporterClass {
  prototype: {
    exportAsOBJ(
      this: M2ExporterLike,
      out: string,
      helper: ExportHelperInstance | null,
      file_manifest: ExportManifestEntry[]
    ): Promise<void>;
  };
}

const skin_sources = new WeakMap<WowBuffer, SkinSource>();
const skin_cache = new WeakMap<WowBuffer, Map<number, M2Skin>>();

const skin_path_resolve = (model_path: string, index: number): string => {
  const stem = model_path.replace(/\.m2$/i, '');
  return stem + String(index).padStart(2, '0') + '.skin';
};

const submeshes_read = (data: WowBuffer, count: number, offset: number): M2SubMesh[] => {
  data.seek(offset);

  const submeshes: M2SubMesh[] = [];

  for (let index = 0; index < count; index++) {
    const submesh: M2SubMesh = {
      submeshID: data.readUInt16LE(),
      level: data.readUInt16LE(),
      vertexStart: data.readUInt16LE(),
      vertexCount: data.readUInt16LE(),
      triangleStart: data.readUInt16LE(),
      triangleCount: data.readUInt16LE(),
      boneCount: data.readUInt16LE(),
      boneStart: data.readUInt16LE(),
      boneInfluences: data.readUInt16LE(),
      centerBoneIndex: data.readUInt16LE(),
      centerPosition: data.readFloatLE(3),
      sortCenterPosition: data.readFloatLE(3),
      sortRadius: data.readFloatLE()
    };

    submesh.triangleStart += submesh.level << 16;
    submeshes.push(submesh);
  }

  return submeshes;
};

const texture_units_read = (data: WowBuffer, count: number, offset: number): M2TextureUnit[] => {
  data.seek(offset);

  const units: M2TextureUnit[] = [];

  for (let index = 0; index < count; index++) {
    units.push({
      flags: data.readUInt8(),
      priority: data.readUInt8(),
      shaderID: data.readUInt16LE(),
      skinSectionIndex: data.readUInt16LE(),
      flags2: data.readUInt16LE(),
      colorIndex: data.readUInt16LE(),
      materialIndex: data.readUInt16LE(),
      materialLayer: data.readUInt16LE(),
      textureCount: data.readUInt16LE(),
      textureComboIndex: data.readUInt16LE(),
      textureCoordComboIndex: data.readUInt16LE(),
      textureWeightComboIndex: data.readUInt16LE(),
      textureTransformComboIndex: data.readUInt16LE()
    });
  }

  return units;
};

export const skin_parse = (data: WowBuffer): M2Skin => {
  data.seek(0);

  const magic = String.fromCharCode(...data.readUInt8(4));

  if (magic !== SKIN_MAGIC)
    throw new Error('not a skin file (magic ' + magic + ')');

  const indices_count = data.readUInt32LE();
  const indices_offset = data.readUInt32LE();
  const triangles_count = data.readUInt32LE();
  const triangles_offset = data.readUInt32LE();
  const properties_count = data.readUInt32LE();
  const properties_offset = data.readUInt32LE();
  const submeshes_count = data.readUInt32LE();
  const submeshes_offset = data.readUInt32LE();
  const units_count = data.readUInt32LE();
  const units_offset = data.readUInt32LE();
  const bones = data.readUInt32LE();

  data.seek(indices_offset);
  const indices = data.readUInt16LE(indices_count);

  data.seek(triangles_offset);
  const triangles = data.readUInt16LE(triangles_count);

  data.seek(properties_offset);
  const properties = data.readUInt8(properties_count);

  return {
    indices,
    triangles,
    properties,
    subMeshes: submeshes_read(data, submeshes_count, submeshes_offset),
    textureUnits: texture_units_read(data, units_count, units_offset),
    bones,
    isLoaded: true
  };
};

export const m2_skin_patch = (): void => {
  const BufferWrapper = wow_module_load<BufferWrapperModule>('buffer');
  const m2_loader = wow_module_load<M2LoaderClass>('3D/loaders/M2LegacyLoader');
  const m2_exporter = wow_module_load<M2ExporterClass>('3D/exporters/M2LegacyExporter');

  const original_export = m2_exporter.prototype.exportAsOBJ;

  m2_exporter.prototype.exportAsOBJ = async function export_tracked(
    this: M2ExporterLike,
    out: string,
    helper: ExportHelperInstance | null,
    file_manifest: ExportManifestEntry[]
  ): Promise<void> {
    skin_sources.set(this.data, { file_path: this.filePath, mpq: this.mpq });
    return original_export.call(this, out, helper, file_manifest);
  };

  const original_get_skin = m2_loader.prototype.getSkin;

  m2_loader.prototype.getSkin = async function get_skin_external(
    this: M2LoaderLike,
    index: number
  ): Promise<M2Skin | undefined> {
    if (this.version < M2_VER_WOTLK)
      return original_get_skin.call(this, index);

    const cached = skin_cache.get(this.data)?.get(index);

    if (cached !== undefined)
      return cached;

    const source = skin_sources.get(this.data);

    if (source === undefined)
      throw new Error('no skin source registered for this model');

    const skin_path = skin_path_resolve(source.file_path, index);
    const raw = source.mpq.getFile(skin_path);

    if (raw === null)
      throw new Error('skin not present in archives: ' + skin_path);

    const skin = skin_parse(new BufferWrapper(Buffer.from(raw)));
    const per_model = skin_cache.get(this.data) ?? new Map<number, M2Skin>();

    per_model.set(index, skin);
    skin_cache.set(this.data, per_model);

    return skin;
  };
};
