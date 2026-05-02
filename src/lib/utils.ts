export function pick<O extends object, T extends keyof O>(obj: O, keys: T[]): Pick<O, T> {
  const pickedObject = keys.reduce(
    (acc, key) => {
      if (obj[key] !== undefined) {
        acc[key] = obj[key];
      }
      return acc;
    },
    {} as Pick<O, T>
  );

  return pickedObject;
}

export function isTruthy<T>(value: T): value is NonNullable<T> {
  return Boolean(value);
}
