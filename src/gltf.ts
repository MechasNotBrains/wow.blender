import fs from 'node:fs';
import obj2gltf from 'obj2gltf';

export interface GlbWriteResult {
  glb_path: string;
  byte_length: number;
}

export const glb_from_obj_write = async (obj_path: string): Promise<GlbWriteResult> => {
  const glb_path = obj_path.replace(/\.obj$/i, '.glb');

  const glb = await obj2gltf(obj_path, {
    binary: true,
    separate: false,
    separateTextures: false,
    checkTransparency: false,
    doubleSidedMaterial: false,
    metallicRoughness: true,
    inputUpAxis: 'Y',
    outputUpAxis: 'Y',
    logger: () => {}
  });

  await fs.promises.writeFile(glb_path, glb);

  return { glb_path, byte_length: glb.byteLength };
};
