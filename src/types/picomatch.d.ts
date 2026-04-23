declare module "picomatch" {
  export interface PicomatchOptions {
    bash?: boolean;
    contains?: boolean;
    dot?: boolean;
    fastpaths?: boolean;
    nocase?: boolean;
    noext?: boolean;
    noglobstar?: boolean;
    posix?: boolean;
    posixSlashes?: boolean;
    strictBrackets?: boolean;
    unixify?: boolean;
    [key: string]: unknown;
  }

  export type Matcher = (input: string) => boolean;

  interface PicomatchFn {
    (glob: string | string[], options?: PicomatchOptions): Matcher;
    isMatch(input: string, glob: string | string[], options?: PicomatchOptions): boolean;
  }

  const picomatch: PicomatchFn;
  export default picomatch;
}