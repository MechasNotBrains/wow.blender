interface NwShim {
  __dirname: string;
  App: {
    dataPath: string;
    argv: string[];
    manifest: { version: string; flavour: string; guid: string };
  };
  Shell: {
    openItem(target: string): void;
    openExternal(target: string): void;
  };
}

type AnimationFrameCallback = (time: number) => void;

declare var BUILD_RELEASE: boolean;
declare var nw: NwShim;
declare function requestAnimationFrame(callback: AnimationFrameCallback): number;
