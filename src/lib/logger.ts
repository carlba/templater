import pino from 'pino';

export function isNonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value.constructor === Object
  );
}

function getNameFromBindings(
  this: pino.Logger,
  parts: { type: 'string' | 'binding'; value: string }[]
): string {
  const bindings = this.bindings();

  const nameParts = parts
    .map((part): string | null => {
      if (part.type === 'string') {
        return part.value;
      }

      const value: unknown = bindings[part.value];
      if (typeof value === 'string') {
        return value;
      }

      return null;
    })
    .filter(isNonNullable);

  return nameParts.join(':');
}

export function createLogger(
  nameParts: { type: 'string' | 'binding'; value: string }[] = [
    { type: 'binding', value: 'name' },
    { type: 'binding', value: 'module' },
    { type: 'binding', value: 'context' },
  ]
) {
  return pino({
    transport: {
      target: 'pino-pretty',
      options: {
        ignore: 'pid,hostname,context,module',
      },
    },
    hooks: {
      logMethod(args, method) {
        const name = getNameFromBindings.call(this, nameParts);

        const [first, ...rest] = args;

        if (isPlainObject(first)) {
          method.apply(this, [{ ...first, name }, ...rest]);
          return;
        } else if (typeof first === 'string') {
          method.apply(this, [{ name }, first, ...rest]);
        } else {
          method.apply(this, args);
        }
      },
    },
  });
}
