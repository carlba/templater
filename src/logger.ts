import pino from 'pino';

const NAME = null;

export const LOGGER = pino({
  formatters: {
    bindings(bindings) {
      const name = [NAME, bindings.module, bindings.context].filter(Boolean).join(':');
      return { ...bindings, name };
    },
  },
  transport: {
    target: 'pino-pretty',
    options: {
      ignore: 'pid,hostname,context,module',
    },
  },
});
