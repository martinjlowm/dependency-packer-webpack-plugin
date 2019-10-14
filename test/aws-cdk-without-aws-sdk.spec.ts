import { expect } from 'chai';
import * as fs from 'fs';
import { beforeEach, describe, it } from 'mocha';
import * as path from 'path';
import * as webpack from 'webpack';

import { run } from '$/helpers/run';
import * as Types from '$/types';

const exampleProject = 'aws-cdk-without-aws-sdk';
describe(exampleProject, async () => {

  const directory = path.resolve(__dirname, '..', 'examples', exampleProject);

  beforeEach(async () => {
    await run('rm -rf .webpack', directory);
  });

  before(async function () {
    this.timeout(0);

    await run('npm i', directory);
  });

  it('Packs all dependencies for all entries as required in the bundle', async () => {
    const config: webpack.Configuration = (await import(`${directory}/webpack.config`)).default;

    await run('npm run build', directory);

    await new Promise((resolve, reject) => {
      fs.stat(path.resolve(directory, '.webpack'), (error, stats) => {
        if (error) {
          reject(error);
        }

        resolve(stats);
      });
    });

    const { dependencies } = await import(`${config.output.path}/package.json`);

    const dependencyPackerPlugin = config.plugins.find(Types.isDependencyPackerPlugin);

    const dependenciesKeys = Object.keys(dependencies);

    dependencyPackerPlugin.blacklist.forEach((mod) => {
      expect(dependenciesKeys).not.to.include(mod);
    });

    expect(dependenciesKeys).to.include('lodash');
  }).timeout(0);

});
