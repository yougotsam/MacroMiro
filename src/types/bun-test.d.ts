// Minimal typing for bun's built-in test runner (tests run with `bun test`; tsc only type-checks the app).
declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>, options?: number | { timeout?: number }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const expect: (value: unknown) => any;
}
