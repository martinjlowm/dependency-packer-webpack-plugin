import * as childProcess from 'child_process';
import * as fs from 'fs';
import Module = require('module');
import * as path from 'path';
import semver = require('semver');

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
  packageManager: string;
  name: string = 'DependencyPackerPlugin';

  constructor(options) {
    this.cwd = process.cwd();
    this.packageManager = options.packageManager || 'npm';
  }

  apply(compiler: Webpack.Compiler) {
    const { name: projectName } = require(`${this.cwd}/package.json`);
    const newDependencies = {};

    const entryNames = Object.keys(compiler.options.entry);

    if (entryNames.length > 1 && !compiler.options.output.filename.includes('/')) {
      console.warn(`[${this.name}] » Multiple entry points must be written to ` +
                   `separate directories to avoid conflicts, ` +
                   `e.g.: "config.output.filename: '[name]/[name].js'"`);
      return;
    }

    compiler.hooks.compilation.tap(this.name, (compilation, params) => {
      compilation.hooks.finishModules.tap(this.name, (modules: WebpackModule[]) => {
        const dependentModules = modules.filter(mod => !mod.rawRequest);

        dependentModules.forEach(mod => {
          const issuer = mod.issuer;
          if (issuer) {
            const { name, dependencies } = findPackageJSON(mod.issuer.context);

            if (!builtinModules.find(builtInModule => builtInModule === mod.request)) {
              const entryPoints = getEntryPoints(mod);

              let moduleName = mod.request;
              while (!dependencies[moduleName]) {
                moduleName = moduleName.split('/').slice(0, -1).join('/');
              }

              if (!dependencies[moduleName]) {
                console.warn(`[${this.name}] » ${mod.request} was requested, but is not listed in dependencies! Skipping...`);
                return;
              }

              entryPoints.forEach(entryPoint => {
                newDependencies[entryPoint] = newDependencies[entryPoint] || {};
                newDependencies[entryPoint][moduleName] = dependencies[moduleName];
              });
            }
          }
        });
      });
    });

    compiler.hooks.done.tapPromise(this.name, async stats => {
      const outputDirectory = compiler.options.output.path;
      const packaged = entryNames.map(async entryName => {
        const [,entryOutput] = compiler.options.output.filename
          .replace(/\[name\]/g, entryName)
          .match(/^(.+)\/.*$/);

        const entryBundleDirectory = `${outputDirectory}/${entryOutput}`;

        let dependencies = newDependencies[compiler.options.entry[entryName]] || {};
        const peerDependenciesInstallations = Object.keys(dependencies).map(async pkg => {
          const [,version] = dependencies[pkg].match(/^(?:\^|~)?(.+)/);

          if (semver.valid(version)) {
            const result = await new Promise<string>((resolve, reject) => {
              childProcess.exec(`${this.packageManager} info ${pkg}@${version} peerDependencies --json`, {
                cwd: path.resolve(entryBundleDirectory)
              }, (error, stdout) => {
                if (error) {
                  reject(error);
                }

                resolve(stdout);
              });
            });

            let peerDependencies;
            try {
              let type;
              ({ type, ...peerDependencies } = JSON.parse(result));
            } catch (error) {
              peerDependencies = {};
            }

            dependencies = { ...dependencies, ...peerDependencies };
          }
        });

        await Promise.all(peerDependenciesInstallations);

        const entryPackage = {
          name: `${projectName}-${entryName}`,
          dependencies,
        };

        fs.writeFileSync(`${entryBundleDirectory}/package.json`, JSON.stringify(entryPackage, null, 2));

        return new Promise((resolve, reject) => {
          console.info(`[${this.name}] » Installing packages for ${entryName}...`);
          childProcess.exec(`${this.packageManager} install`, { cwd: path.resolve(entryBundleDirectory) }, error => {
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
