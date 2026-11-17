/**
 * Is the error a repository error of this kind? Also checked by its `name` (a string literal on
 * each `@nittcam/db` error class): the bundler can load the db package more than once (one copy
 * per route chunk), and then `instanceof` fails across the copies (D-029).
 */
export function isRepoError<T extends Error>(
  err: unknown,
  cls: abstract new (...args: never[]) => T,
  name: string,
): err is T {
  return err instanceof cls || (err instanceof Error && err.name === name);
}
