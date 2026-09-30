import fs from 'node:fs';

const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
}

export interface GltfTextureRef {
  index: number;
  texCoord?: number;
}

export interface GltfPbr {
  baseColorTexture?: GltfTextureRef;
  [key: string]: unknown;
}

export interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: GltfPbr;
  [key: string]: unknown;
}

export interface GltfTexture {
  source?: number;
  sampler?: number;
}

export interface GltfImage {
  name?: string;
  mimeType?: string;
  bufferView?: number;
  uri?: string;
}

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  target?: number;
}

export interface GltfBuffer {
  byteLength: number;
  uri?: string;
}

export interface GltfScene {
  nodes: number[];
}

export interface GltfDocument {
  scene?: number;
  scenes: GltfScene[];
  nodes: GltfNode[];
  meshes: GltfMesh[];
  materials: GltfMaterial[];
  textures?: GltfTexture[];
  images?: GltfImage[];
  samplers?: Record<string, unknown>[];
  bufferViews: GltfBufferView[];
  buffers: GltfBuffer[];
  [key: string]: unknown;
}

export interface GlbContent {
  json: GltfDocument;
  binary: Uint8Array;
}

const align_up = (value: number): number => {
  return (value + 3) & ~3;
};

export const glb_read = async (glb_path: string): Promise<GlbContent> => {
  const file = await fs.promises.readFile(glb_path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);

  if (view.getUint32(0, true) !== MAGIC_GLTF)
    throw new Error('not a glb file');

  let cursor = HEADER_BYTES;
  let json: GltfDocument | null = null;
  let binary = new Uint8Array(0);

  while (cursor + CHUNK_HEADER_BYTES <= file.byteLength) {
    const chunk_length = view.getUint32(cursor, true);
    const chunk_type = view.getUint32(cursor + 4, true);
    const start = cursor + CHUNK_HEADER_BYTES;
    const body = new Uint8Array(file.buffer, file.byteOffset + start, chunk_length);

    if (chunk_type === CHUNK_JSON)
      json = JSON.parse(new TextDecoder().decode(body)) as GltfDocument;
    else if (chunk_type === CHUNK_BIN)
      binary = new Uint8Array(body);

    cursor = start + align_up(chunk_length);
  }

  if (json === null)
    throw new Error('glb has no json chunk');

  return { json, binary };
};

export const glb_write = async (glb_path: string, content: GlbContent): Promise<number> => {
  const json_bytes = new TextEncoder().encode(JSON.stringify(content.json));
  const json_padded = align_up(json_bytes.length);
  const binary_padded = align_up(content.binary.length);

  const total = HEADER_BYTES +
    CHUNK_HEADER_BYTES + json_padded +
    (binary_padded === 0 ? 0 : CHUNK_HEADER_BYTES + binary_padded);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, MAGIC_GLTF, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  let cursor = HEADER_BYTES;

  view.setUint32(cursor, json_padded, true);
  view.setUint32(cursor + 4, CHUNK_JSON, true);
  out.set(json_bytes, cursor + CHUNK_HEADER_BYTES);
  out.fill(0x20, cursor + CHUNK_HEADER_BYTES + json_bytes.length, cursor + CHUNK_HEADER_BYTES + json_padded);
  cursor += CHUNK_HEADER_BYTES + json_padded;

  if (binary_padded !== 0) {
    view.setUint32(cursor, binary_padded, true);
    view.setUint32(cursor + 4, CHUNK_BIN, true);
    out.set(content.binary, cursor + CHUNK_HEADER_BYTES);
  }

  await fs.promises.writeFile(glb_path, out);

  return total;
};

export const binary_append = (content: GlbContent, bytes: Uint8Array): number => {
  const offset = align_up(content.binary.length);
  const grown = new Uint8Array(offset + bytes.length);

  grown.set(content.binary, 0);
  grown.set(bytes, offset);

  content.binary = grown;

  const buffer = content.json.buffers[0];

  if (buffer !== undefined)
    buffer.byteLength = grown.length;

  content.json.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.length
  });

  return content.json.bufferViews.length - 1;
};
