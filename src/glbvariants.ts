import fs from 'node:fs';
import path from 'node:path';

import { binary_append, glb_read, glb_write } from './glb.ts';

import type { GlbContent, GltfMaterial, GltfMesh, GltfPrimitive } from './glb.ts';
import type { VariantManifest } from './variants.ts';

export interface VariantInjectResult {
  variants: number;
  meshes: number;
  byte_length: number;
}

const stem_resolve = (name: string): string => {
  const base = name.split(/[\\/]+/).pop() ?? name;
  return base.replace(/\.[^.]+$/, '').toLowerCase();
};

const sampler_ensure = (content: GlbContent): number => {
  const samplers = content.json.samplers ?? [];

  if (samplers.length === 0)
    samplers.push({ wrapS: 10497, wrapT: 10497 });

  content.json.samplers = samplers;

  return 0;
};

const material_stem_resolve = (content: GlbContent, material: GltfMaterial): string => {
  const reference = material.pbrMetallicRoughness?.baseColorTexture;
  const textures = content.json.textures ?? [];
  const images = content.json.images ?? [];

  if (reference !== undefined) {
    const source = textures[reference.index]?.source;
    const image_name = source === undefined ? undefined : images[source]?.name;

    if (image_name !== undefined && image_name.length !== 0)
      return stem_resolve(image_name);
  }

  return stem_resolve(material.name ?? '');
};

const base_index_resolve = (material_stem: string, base_textures: string[]): number => {
  for (let index = 0; index < base_textures.length; index++) {
    const candidate = stem_resolve(base_textures[index] ?? '');

    if (candidate.length === 0)
      continue;

    if (material_stem === candidate || material_stem.endsWith(candidate))
      return index;
  }

  return -1;
};

const texture_ensure = async (
  content: GlbContent,
  asset_dir: string,
  png_name: string,
  cache: Map<string, number>
): Promise<number | null> => {
  const cached = cache.get(png_name.toLowerCase());

  if (cached !== undefined)
    return cached;

  const png_path = path.join(asset_dir, png_name);

  if (fs.existsSync(png_path) === false)
    return null;

  const bytes = await fs.promises.readFile(png_path);
  const buffer_view = binary_append(content, new Uint8Array(bytes));

  const images = content.json.images ?? [];
  images.push({ name: stem_resolve(png_name), mimeType: 'image/png', bufferView: buffer_view });
  content.json.images = images;

  const textures = content.json.textures ?? [];
  textures.push({ source: images.length - 1, sampler: sampler_ensure(content) });
  content.json.textures = textures;

  const texture_index = textures.length - 1;
  cache.set(png_name.toLowerCase(), texture_index);

  return texture_index;
};

const material_variant_build = (
  content: GlbContent,
  source: GltfMaterial,
  texture_index: number,
  suffix: string
): number => {
  const clone = JSON.parse(JSON.stringify(source)) as GltfMaterial;

  clone.name = (source.name ?? 'material') + '_' + suffix;

  const pbr = clone.pbrMetallicRoughness ?? {};
  pbr.baseColorTexture = { index: texture_index };
  clone.pbrMetallicRoughness = pbr;

  content.json.materials.push(clone);

  return content.json.materials.length - 1;
};

export const glb_variants_inject = async (
  glb_path: string,
  manifest: VariantManifest
): Promise<VariantInjectResult> => {
  const content = await glb_read(glb_path);
  const asset_dir = path.dirname(glb_path);
  const base_textures = manifest.base?.textures ?? [];

  const base_meshes = [...content.json.meshes];
  const scene = content.json.scenes[content.json.scene ?? 0];
  const texture_cache = new Map<string, number>();

  let added_meshes = 0;
  let added_variants = 0;

  for (const variant of manifest.variants) {
    const suffix = String(variant.display_id);
    let mesh_added_here = 0;

    for (const base_mesh of base_meshes) {
      const primitives: GltfPrimitive[] = [];

      for (const primitive of base_mesh.primitives) {
        if (primitive.material === undefined)
          continue;

        const source_material = content.json.materials[primitive.material];

        if (source_material === undefined)
          continue;

        const material_stem = material_stem_resolve(content, source_material);
        const slot = base_index_resolve(material_stem, base_textures);

        if (slot === -1 || slot >= variant.textures.length)
          continue;

        const png_name = variant.textures[slot];

        if (png_name === undefined)
          continue;

        const texture_index = await texture_ensure(content, asset_dir, png_name, texture_cache);

        if (texture_index === null)
          continue;

        primitives.push({
          attributes: primitive.attributes,
          indices: primitive.indices,
          mode: primitive.mode,
          material: material_variant_build(content, source_material, texture_index, suffix)
        });
      }

      if (primitives.length === 0)
        continue;

      const mesh: GltfMesh = { name: (base_mesh.name ?? 'mesh') + '_' + suffix, primitives };
      content.json.meshes.push(mesh);

      content.json.nodes.push({
        name: mesh.name,
        mesh: content.json.meshes.length - 1
      });

      scene?.nodes.push(content.json.nodes.length - 1);

      added_meshes++;
      mesh_added_here++;
    }

    if (mesh_added_here !== 0)
      added_variants++;
  }

  const byte_length = await glb_write(glb_path, content);

  return { variants: added_variants, meshes: added_meshes, byte_length };
};
