declare module 'obj2gltf' {
  export type UpAxis = 'X' | 'Y' | 'Z';

  export interface Obj2GltfOptions {
    binary?: boolean;
    separate?: boolean;
    separateTextures?: boolean;
    checkTransparency?: boolean;
    doubleSidedMaterial?: boolean;
    secure?: boolean;
    packOcclusion?: boolean;
    metallicRoughness?: boolean;
    specularGlossiness?: boolean;
    unlit?: boolean;
    inputUpAxis?: UpAxis;
    outputUpAxis?: UpAxis;
    triangleWindingOrderSanitization?: boolean;
    overridingTextures?: Record<string, string>;
    outputDirectory?: string;
    logger?: (message: string) => void;
    writer?: (relative_path: string, contents: Buffer) => Promise<void>;
  }

  function obj2gltf(obj_path: string, options: Obj2GltfOptions & { binary: true }): Promise<Buffer>;
  function obj2gltf(obj_path: string, options?: Obj2GltfOptions): Promise<Record<string, unknown>>;

  export default obj2gltf;
}
