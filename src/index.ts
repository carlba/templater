#! /usr/bin/env node

import { Command } from '@commander-js/extra-typings';
import { run } from './template';

new Command()
  .name('watch')
  .description('Watch MQ')
  .argument('[directory]')
  .option(
    '-u, --uri <URI>',
    'The URI to fetch the template from',
    'https://raw.githubusercontent.com/carlba/typescript-template/main'
  )
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  .action(async (directory, options) => {
    await run(options.uri, directory ?? '.');
  })
  .parse(process.argv);
