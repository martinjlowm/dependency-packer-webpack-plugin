import * as lambda from '@aws-cdk/aws-lambda';
import * as cdk from '@aws-cdk/core';

export class Stack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new lambda.Function(this, 'MainEntry', {
      functionName: 'example-dependency-packer-without-aws-sdk',
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: 'main.handler',
      code: lambda.Code.asset('.webpack/main'),
    });
  }
}

const app = new cdk.App();

new Stack(app, 'example-dependency-packer-without-aws-sdk');

app.synth();
