import type { EventEmitter } from 'node:events';

export interface WowConfig {
  exportDirectory: string;
  pathFormat: 'win32' | 'posix';
  modelsExportTextures: boolean;
  modelsExportAlpha: boolean;
  modelsExportCollision: boolean;
  modelsExportUV2: boolean;
  modelsExportWMOGroups: boolean;
  overwriteFiles: boolean;
  removePathSpaces: boolean;
  enableAbsoluteMTLPaths: boolean;
  enableSharedTextures: boolean;
  enableSharedChildren: boolean;
  [key: string]: unknown;
}

export interface MpqInstall {
  build_id: string | null;
  loadInstall(): Promise<void>;
  close(): void;
  getAllFiles(): string[];
  getFilesByExtension(extension: string): string[];
  getFile(display_path: string): Buffer | null;
  getFileCount(): number;
  getArchiveCount(): number;
}

export interface MpqInstallModule {
  MPQInstall: new (directory: string) => MpqInstall;
}

export interface WowView {
  config: WowConfig;
  installType: number;
  isBusy: number;
  exportCancelled: boolean;
  mpq: MpqInstall | null;
  casc: unknown;
  [key: string]: unknown;
}

export interface WowCore {
  view: WowView;
  events: EventEmitter;
  makeNewView(): WowView;
  setToast(toast_type: string, message: string, options?: unknown, ttl?: number, closable?: boolean): void;
  showLoadingScreen(segments?: number, title?: string): void;
  progressLoadingScreen(text?: string): Promise<void>;
  hideLoadingScreen(): void;
}

export interface InstallTypeModule {
  MPQ: number;
  CASC: number;
}

export interface ExportManifestEntry {
  type: string;
  file: string;
}

export interface ExportHelperInstance {
  succeeded: number;
  readonly failed: number;
  start(): void;
  finish(include_dir_link?: boolean): void;
  isCancelled(): boolean;
  mark(item: string, state: boolean, error?: string, stack_trace?: string | null): void;
  setCurrentTaskName(name: string): void;
  clearCurrentTask(): void;
}

export interface ExportHelperModule {
  new (count: number, unit?: string): ExportHelperInstance;
  getExportPath(file: string): string;
  getRelativeExport(file: string): string;
  replaceExtension(file: string, ext?: string): string;
  win32ToPosix(value: string): string;
  sanitizeFilename(value: string): string;
}

export interface WowBuffer {
  readonly byteLength: number;
  offset: number;
  seek(position: number): void;
  readUInt8(): number;
  readUInt8(count: number): number[];
  readUInt16LE(): number;
  readUInt16LE(count: number): number[];
  readUInt32LE(): number;
  readUInt32LE(count: number): number[];
  readFloatLE(): number;
  readFloatLE(count: number): number[];
}

export interface M2SubMesh {
  submeshID: number;
  level: number;
  vertexStart: number;
  vertexCount: number;
  triangleStart: number;
  triangleCount: number;
  boneCount: number;
  boneStart: number;
  boneInfluences: number;
  centerBoneIndex: number;
  centerPosition: number[];
  sortCenterPosition: number[];
  sortRadius: number;
}

export interface M2TextureUnit {
  flags: number;
  priority: number;
  shaderID: number;
  skinSectionIndex: number;
  flags2: number;
  colorIndex: number;
  materialIndex: number;
  materialLayer: number;
  textureCount: number;
  textureComboIndex: number;
  textureCoordComboIndex: number;
  textureWeightComboIndex: number;
  textureTransformComboIndex: number;
}

export interface M2Skin {
  indices: number[];
  triangles: number[];
  properties: number[];
  subMeshes: M2SubMesh[];
  textureUnits: M2TextureUnit[];
  bones: number;
  isLoaded: boolean;
}

export type BufferWrapperModule = new (buffer: Buffer) => WowBuffer;

export interface BlpFile {
  saveToPNG(file: string, mask?: number, mipmap?: number): Promise<void>;
}

export type BlpFileModule = new (data: WowBuffer) => BlpFile;

export interface LegacyExporter {
  exportAsOBJ(out: string, helper: ExportHelperInstance | null, file_manifest: ExportManifestEntry[]): Promise<void>;
}

export interface M2LegacyExporterInstance extends LegacyExporter {
  setSkinTextures(textures: string[]): void;
  m2: M2LoadedModel | null;
}

export interface M2MaterialFlags {
  flags: number;
  blendingMode: number;
}

export interface M2TextureEntry {
  fileName: string;
}

export interface M2LoadedModel {
  materials: M2MaterialFlags[];
  textureCombos: number[];
  textures: M2TextureEntry[];
  textureTypes: number[];
  getSkin(index: number): Promise<M2Skin | undefined>;
}

export interface CreatureDisplay {
  id: number;
  textures: string[];
}

export interface DbcRow {
  [key: string]: unknown;
}

export interface DbcReaderInstance {
  parse(data: WowBuffer): Promise<void>;
  getAllRows(): Map<number, DbcRow>;
}

export type DbcReaderModule = new (file_name: string, build_id: string) => DbcReaderInstance;

export interface CreatureDbModule {
  initializeCreatureData(mpq: MpqInstall, build_id: string | null): Promise<void>;
  getCreatureDisplaysByPath(model_path: string): CreatureDisplay[] | undefined;
  reset(): void;
}

export type LegacyExporterModule = new (data: WowBuffer, file_path: string, mpq: MpqInstall) => LegacyExporter;

export interface WmoLegacyExporterModule extends LegacyExporterModule {
  clearCache(): void;
}
