import 'amazon-dax-client';
import 'aws-sdk';
import Lambda from 'aws-sdk/clients/lambda';
import 'fs';
import 'source-map-support/register';
import 'subscriptions-transport-ws';

import '@/helpers/circular';

const _lambda = new Lambda();
