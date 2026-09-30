import { glb_read, glb_write } from './glb.ts';
import { wow_module_load } from './wowexport.ts';

import type { GltfMaterial, GlbContent } from './glb.ts';
import type { M2LoadedModel, M2Skin } from './types.ts';

const FLAG_TWO_SIDED = 0x04;

const BLEND_OPAQUE = 0;
const BLEND_ALPHA_KEY = 1;

export type AlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';

export interface MaterialRender {
  two_sided: boolean;
  alpha_mode: AlphaMode;
}

interface GeosetMapperModule {
  getGeosetName(index: number, id: number): string;
}

const alpha_mode_resolve = (blending_mode: number): AlphaMode => {
  if (blending_mode === BLEND_OPAQUE)
    return 'OPAQUE';

  if (blending_mode === BLEND_ALPHA_KEY)
    return 'MASK';

  return 'BLEND';
};

export const render_map_build = async (m2: M2LoadedModel): Promise<Map<string, MaterialRender>> => {
  const render = new Map<string, MaterialRender>();
  const skin: M2Skin | undefined = await m2.getSkin(0);

  if (skin === undefined)
    return render;

  const GeosetMapper = wow_module_load<GeosetMapperModule>('3D/GeosetMapper');

  for (let index = 0; index < skin.subMeshes.length; index++) {
    const submesh = skin.subMeshes[index];

    if (submesh === undefined)
      continue;

    const unit = skin.textureUnits.find(entry => entry.skinSectionIndex === index);

    if (unit === undefined)
      continue;

    const material = m2.materials[unit.materialIndex];

    if (material === undefined)
      continue;

    render.set(GeosetMapper.getGeosetName(index, submesh.submeshID), {
      two_sided: (material.flags & FLAG_TWO_SIDED) !== 0,
      alpha_mode: alpha_mode_resolve(material.blendingMode)
    });
  }

  return render;
};

const material_variant_ensure = (
  content: GlbContent,
  material_index: number,
  entry: MaterialRender,
  cache: Map<string, number>
): number => {
  const source = content.json.materials[material_index];

  if (source === undefined)
    return material_index;

  const matches = source.doubleSided === entry.two_sided &&
    source.alphaMode === entry.alpha_mode;

  if (matches)
    return material_index;

  const key = String(material_index) + '|' + String(entry.two_sided) + '|' + entry.alpha_mode;
  const cached = cache.get(key);

  if (cached !== undefined)
    return cached;

  const clone = JSON.parse(JSON.stringify(source)) as GltfMaterial;

  clone.name = (source.name ?? 'material') + '_' + entry.alpha_mode.toLowerCase();
  clone.doubleSided = entry.two_sided;
  clone.alphaMode = entry.alpha_mode;

  if (entry.alpha_mode === 'MASK')
    clone.alphaCutoff = 0.5;
  else
    delete clone.alphaCutoff;

  content.json.materials.push(clone);

  const clone_index = content.json.materials.length - 1;
  cache.set(key, clone_index);

  return clone_index;
};

export const glb_render_apply = async (
  glb_path: string,
  render: Map<string, MaterialRender>
): Promise<number> => {
  const content = await glb_read(glb_path);
  const cache = new Map<string, number>();

  for (const material of content.json.materials) {
    material.doubleSided = false;
    material.alphaMode = 'OPAQUE';
    delete material.alphaCutoff;
  }

  for (const mesh of content.json.meshes) {
    const entry = render.get(mesh.name ?? '');

    if (entry === undefined)
      continue;

    for (const primitive of mesh.primitives) {
      if (primitive.material === undefined)
        continue;

      primitive.material = material_variant_ensure(content, primitive.material, entry, cache);
    }
  }

  return glb_write(glb_path, content);
};
