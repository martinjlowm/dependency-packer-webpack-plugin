import { expect } from 'chai';
import * as fs from 'fs';
import { beforeEach, describe, it } from 'mocha';
import * as path from 'path';
import * as webpack from 'webpack';

import { run } from '$/helpers/run';
import * as Types from '$/types';

describe('recursive-entry', () => {

  const directory = path.resolve(__dirname, 'recursive-entry');

  beforeEach(async () => {
    await run(`rm -rf .webpack`, directory);
  });

  before(async function () {
    this.timeout(0);

    await run('npm i', directory);
  });

  it('Packs all dependencies for all entries as required in the bundle', async () => {
    const webpackConfig: webpack.Configuration[] = (await import(`${directory}/webpack.config`)).default;

    const [firstEntryConfig] = webpackConfig;

    const outputPath = firstEntryConfig.output.path;

    await run('npx webpack', directory);

    await new Promise((resolve, reject) => {
      fs.stat(path.resolve(directory, '.webpack'), (error, stats) => {
        if (error) {
          reject(error);
        }

        resolve(stats);
      });
    });

    const { dependencies } = await import(`${outputPath}/package.json`);

    const dependencyPackerPlugin = firstEntryConfig.plugins.find(Types.isDependencyPackerPlugin);

    const dependenciesKeys = Object.keys(dependencies);

    dependencyPackerPlugin.blacklist.forEach((mod) => {
      expect(dependenciesKeys).not.to.include(mod);
    });
    expect(dependenciesKeys).not.to.include('fs');

    expect(dependenciesKeys).to.include('amazon-dax-client');
    expect(dependenciesKeys).to.include('subscriptions-transport-ws');
  }).timeout(0);

});
