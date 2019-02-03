import * as childProcess from 'child_process';
import * as fs from 'fs';
import module = require('module');
import * as path from 'path';

import { Tapable } from 'tapable';
import * as Webpack from 'webpack';

const builtinModules = module.builtinModules || require('./builtin-modules').modules;

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

class DependencyPackerPlugin implements Tapable.Plugin {

  name: string = 'DependencyPackerPlugin';

  // Define `apply` as its prototype method which is supplied with compiler as its argument
  apply(compiler: Webpack.Compiler) {
    const { name: projectName } = require('./package.json');
    const packageManager = 'yarn';
    const newDependencies = {};

    // Specify the event hook to attach to
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

        const entryBundleDirectory = `.webpack/${entryName}`;

        fs.writeFileSync(`${entryBundleDirectory}/package.json`, JSON.stringify(entryPackage, null, 2));

        return new Promise((resolve, reject) => {
          console.info(`[${this.name}] » Installing packages for ${entryName}...`);
          childProcess.exec(`${packageManager}`, { cwd: path.resolve(entryBundleDirectory) }, error => {
            if (error) {
              reject(error);
            }

            resolve();
          });
        });
      });

      await Promise.all(packaged);

      console.info('[${this.name}] » Finished installing packages for all entry points.');
    });
  }
}
