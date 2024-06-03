import { Command } from '@commander-js/extra-typings';
import { run } from './template';

new Command()
  .name('watch')
  .description('Watch MQ')
  .option(
    '-u, --uri <URI>',
    'The URI to fetch the template from',
    'https://raw.githubusercontent.com/carlba/typescript-template/main'
  )
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  .action(async options => {
    await run(options.uri, '/Users/cbackstrom/development/templater', undefined, {
      scripts: { 'start:dev': 'nodemon -r dotenv/config -q src/index.ts' },
    });
  })
  .parse(process.argv);
