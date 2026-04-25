declare module 'split2' {
  import type { Transform } from 'node:stream';

  function split2(
    splitter?: string | RegExp,
    mapper?: (line: string) => string,
    options?: unknown
  ): Transform;

  namespace split2 {}

  export default split2;
}
