import { expect } from 'chai';
import * as fs from 'fs';
import { beforeEach, describe, it } from 'mocha';
import * as path from 'path';
import * as webpack from 'webpack';

import { run } from '$/helpers/run';
import * as Types from '$/types';

describe('Dependency Packer', () => {

  beforeEach(async () => {
    await run(`rm -rf .webpack`);
  });

  it('Packs all dependencies for all entries as demanded in the bundle', async () => {
    const webpackConfig: webpack.Configuration[] = (await import(`${__dirname}/webpack.config`)).default;

    const [firstEntryConfig] = webpackConfig;

    const outputPath = firstEntryConfig.output.path;

    await run('yarn webpack');

    await new Promise((resolve, reject) => {
      fs.stat(path.resolve(__dirname, '.webpack'), (error, stats) => {
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
