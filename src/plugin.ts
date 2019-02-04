import * as childProcess from 'child_process';
import * as fs from 'fs';
import Module = require('module');
import * as path from 'path';

import { Tapable } from 'tapable';
import * as Webpack from 'webpack';

const builtinModules = Module.builtinModules || require('./builtin-modules').modules;

const findPackageJSON = dirPath => {
  const files = fs.readdirSync(dirPath);
  if (files.some(file => file === 'package.json')) {
    return require(`${dirPath}/package.json`);
  } else {
    return findPackageJSON(path.resolve(`${dirPath}/..`));
  }
};

const getEntryPoints = (module, entryPoints = new Set([])) => {
  module.reasons.forEach(reason => {
    if (reason.module) {
      getEntryPoints(reason.module, entryPoints);
    } else {
      entryPoints.add(module.rawRequest);
    }
  });

  return entryPoints;
};

interface WebpackModule extends Webpack.Module {
  context: string;
  issuer: WebpackModule;
  rawRequest?: string;
  request: string;
}

export class DependencyPackerPlugin implements Tapable.Plugin {

  cwd: string;
  installCommand: string;
  name: string = 'DependencyPackerPlugin';

  constructor(options) {
    this.cwd = process.cwd();
    this.installCommand = options.installCommand || 'npm i';
  }

  apply(compiler: Webpack.Compiler) {
    const { name: projectName } = require(`${this.cwd}/package.json`);
    const newDependencies = {};

    compiler.hooks.compilation.tap(this.name, (compilation, params) => {
      compilation.hooks.finishModules.tap(this.name, (modules: WebpackModule[]) => {
        const dependencies = modules.filter(mod => !mod.rawRequest);

        dependencies.forEach(mod => {
          const issuer = mod.issuer;
          if (issuer) {
            const { name, dependencies } = findPackageJSON(mod.issuer.context);

            if (!builtinModules.find(builtInModule => builtInModule === mod.request)) {
              const entryPoints = getEntryPoints(mod);

              entryPoints.forEach(entryPoint => {
                newDependencies[entryPoint] = newDependencies[entryPoint] || {};
                newDependencies[entryPoint][mod.request] = dependencies[mod.request];
              });
            }
          }
        });
      });
    });

    compiler.hooks.done.tapPromise(this.name, async stats => {
      const entryNames = Object.keys(compiler.options.entry);

      const packaged = entryNames.map(entryName => {
        const entryPackage = {
          name: `${projectName}-${entryName}`,
          dependencies: newDependencies[compiler.options.entry[entryName]] || {},
        };

        const entryBundleDirectory = `${this.cwd}/.webpack/${entryName}`;

        fs.writeFileSync(`${entryBundleDirectory}/package.json`, JSON.stringify(entryPackage, null, 2));

        return new Promise((resolve, reject) => {
          console.info(`[${this.name}] » Installing packages for ${entryName}...`);
          childProcess.exec(`${this.installCommand}`, { cwd: path.resolve(entryBundleDirectory) }, error => {
            if (error) {
              reject(error);
            }

            resolve();
          });
        });
      });

      await Promise.all(packaged);

      console.info(`[${this.name}] » Finished installing packages for all entry points.`);
    });
  }
}
