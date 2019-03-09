import { expect } from 'chai';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import { beforeEach, describe, it } from 'mocha';
import * as path from 'path';

import webpackConfig from '$/webpack.config';

const run = async (command) => {
  return await new Promise((resolve, reject) => {
    childProcess.exec(command, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      }

      if (process.env.VERBOSE) {
        stdout && console.debug('[stdout]:', stdout);
        stderr && console.debug('[stderr]:', stderr);
      }

      resolve(stdout);
    });
  });
};

describe('Dependency Packer', () => {

  const [firstEntryConfig, secondEntryConfig] = webpackConfig;

  beforeEach(async () => {
    await run(`rm -rf .webpack`);
  });

  it('Packs all dependencies for all entries as demanded in the bundle', async () => {
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

    for (const config of webpackConfig) {
      const [entryName] = Object.keys(config.entry);
      const { dependencies } = await import(`${outputPath}/package.json`);

      const dependencyPackerPlugin = firstEntryConfig.plugins.find((plugin) => plugin.name === 'DependencyPackerPlugin');

      const dependenciesKeys = Object.keys(dependencies);

      dependencyPackerPlugin.blacklist.forEach((mod) => {
        expect(dependenciesKeys).not.to.include(mod);
      });
      expect(dependenciesKeys).not.to.include('fs');

      expect(dependenciesKeys).to.include('amazon-dax-client');
      expect(dependenciesKeys).to.include('subscriptions-transport-ws');
    }
  }).timeout(0);

});
