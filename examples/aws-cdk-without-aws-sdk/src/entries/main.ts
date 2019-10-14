import { Handler } from 'aws-lambda';
import * as AWS from 'aws-sdk';
import Lambda from 'aws-sdk/clients/lambda';
import _ from 'lodash';

export const handler: Handler = async () => {
  const sts = new AWS.STS();

  const identity = await sts.getCallerIdentity().promise();

  console.info('» Identity result:', identity);

  const lambda = new Lambda();
  const functions = lambda.listFunctions().promise();

  console.info('» Lambda functions in this region:', functions);

  console.info('» Lodash is included:', _);
};
