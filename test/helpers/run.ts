import * as childProcess from 'child_process';

export const run = async (command: string, cwd: string = __dirname) => {
  return await new Promise((resolve, reject) => {
    childProcess.exec(command, { cwd }, (error, stdout, stderr) => {
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
