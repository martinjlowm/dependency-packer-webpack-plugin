import * as childProcess from 'child_process';
import fastJSONStringify = require('fast-json-stringify');
import * as fs from 'fs';
import Module = require('module');
import * as path from 'path';
import semver = require('semver');

import { Tapable } from 'tapable';
import * as Webpack from 'webpack';

const builtinModules = Module.builtinModules || require('./builtin-modules').modules;
const stringify = fastJSONStringify({
  title: 'package.json',
  type: 'object',
  properties: {
    name: {
      type: 'string',
    },
    dependencies: {
      type: 'object',
      patternProperties: {
        '^(?:@([^/]+?)[/])?([^/]+?)$': {
          type: 'string',
        }
      }
    },
  },
});


const findPackageJSON = dirPath => {
  const files = fs.readdirSync(dirPath);
  if (files.some(file => file === 'package.json')) {
    return require(`${dirPath}/package.json`);
  } else {
    return findPackageJSON(path.resolve(`${dirPath}/..`));
  }
};

const getEntryPoints = (module, entryPoints = new Set([]), visitedFiles = {}) => {
  visitedFiles[module.userRequest] = true;

  module.reasons.forEach(reason => {
    if (reason.module) {
      if (visitedFiles[reason.module.userRequest]) {
        return;
      }

      getEntryPoints(reason.module, entryPoints, visitedFiles);
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
  blacklist: Array<string | RegExp>;
  name: string = 'DependencyPackerPlugin';

  projectName: string;
  entries: string | string[] | Webpack.Entry | Webpack.EntryFunc;
  outputDirectory: string;
  dependencies: { [entryName: string]: { [packageName: string]: string } } = {};
  run: boolean;

  constructor(options) {
    this.cwd = process.cwd();
    this.packageManager = options.packageManager || 'npm';
    this.blacklist = options.blacklist || [];
  }

  private onBeforeRun = async (compiler) => {
    this.run = compiler.outputFileSystem.constructor.name === 'NodeOutputFileSystem';
    if (!this.run) {
      console.info(
        `[${this.name}] ` +
        `» Dependency packing only makes sense for NodeOutputFileSystem.`
      );
    }
  }

  private onCompilationFinishModules = (modules) => {
    if (!this.run) {
      return;
    }

    const dependentModules = modules.filter(mod => !mod.rawRequest);

    dependentModules.forEach(mod => {
      const issuer = mod.issuer;
      if (issuer) {
        const { name, dependencies } = findPackageJSON(mod.issuer.context);

        if (!builtinModules.find(builtInModule => builtInModule === mod.request)) {
          const entryPoints = getEntryPoints(mod);

          let moduleName = mod.request;
          while (moduleName && !dependencies[moduleName]) {
            moduleName = moduleName.split('/').slice(0, -1).join('/');
          }

          if (!dependencies[moduleName]) {
            console.warn(`[${this.name}] » ${mod.request} was requested, but is not listed in dependencies! Skipping...`);
            return;
          }

          if (this.blacklist.some(blacklisted => !!moduleName.match(blacklisted))) {
            console.info(`[${this.name}] » ${moduleName} is blacklisted. Skipping...`);
            return;
          }

          entryPoints.forEach(entryPoint => {
            this.dependencies[entryPoint] = this.dependencies[entryPoint] || {};
            this.dependencies[entryPoint][moduleName] = dependencies[moduleName];
          });
        }
      }
    });
  }

  private onDone = async () => {
    if (!this.run) {
      return;
    }

    let dependencies = {};
    const packaged = Object.keys(this.entries).map(async entryName => {
      const entryOutput = this.entries[entryName];

      try {
        await new Promise((resolve, reject) => fs.stat(this.outputDirectory, (error, stats) => {
          if (error) {
            reject(error);
          }

          resolve(stats);
        }));
      } catch (error) {
        console.error(
          `[${this.name}] ` +
          `Webpack failed to generate output directory: ${error.message}`,
        );
        return;
      }

      dependencies = { ...dependencies, ...(this.dependencies[this.entries[entryName]] || {}), };
      const peerDependenciesInstallations = Object.keys(dependencies).map(async pkg => {
        const [, version] = dependencies[pkg].match(/^(?:\^|~)?(.+)/);

        if (semver.valid(version)) {
          const result = await new Promise<string>((resolve, reject) => {
            childProcess.exec(`${this.packageManager} info ${pkg}@${version} peerDependencies --json`, {
              cwd: this.outputDirectory
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
            if (type) {
              peerDependencies = peerDependencies.data;
            }
          } catch (_) { }

          dependencies = { ...dependencies, ...(peerDependencies || {}) };
        }
      });

      return Promise.all(peerDependenciesInstallations);
    });

    await Promise.all(packaged);

    const entryPackage = {
      dependencies,
    };

    await new Promise((resolve, reject) => {
      fs.writeFile(
        `${this.outputDirectory}/package.json`, stringify(entryPackage),
        (error) => {
          if (error) {
            reject(error);
          }

          resolve();
        });
    })

    console.info(
      `[${this.name}] ` +
      `» Installing packages for \`${Object.keys(this.entries).join(', ')}'...`,
    );

    try {
      await new Promise((resolve, reject) => {
        childProcess.exec(
          `${this.packageManager} install`, {
            cwd: path.resolve(this.outputDirectory),
          },
          (error) => {
            if (error) {
              reject(error);
            }

            resolve();
          });
      });

      console.info(
        `[${this.name}] ` +
        '» Finished installing packages.',
      );
    } catch (_) { }
  }

  apply(compiler: Webpack.Compiler) {
    if (Array.isArray(compiler.options.entry) &&
      compiler.options.entry.length &&
      compiler.options.entry[0] === 'string') {
      console.info(
        `[${this.name}] ` +
        `» The behavior of an entry as a string array has not yet been defined.`,
      );
      return;
    } else if (typeof compiler.options.entry === 'string') {
      this.entries = { output: compiler.options.entry };
    } else {
      this.entries = compiler.options.entry;
    }

    this.outputDirectory = compiler.options.output.path;

    ({ name: this.projectName } = require(`${this.cwd}/package.json`));

    // Hooks
    compiler.hooks.beforeRun.tapPromise(this.name, this.onBeforeRun);

    compiler.hooks.compilation.tap(this.name, (compilation) => {
      compilation.hooks.finishModules.tap(
        this.name, this.onCompilationFinishModules);
    });

    compiler.hooks.done.tapPromise(this.name, this.onDone);
  }
}
