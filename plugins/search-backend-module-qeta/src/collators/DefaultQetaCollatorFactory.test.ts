/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  getVoidLogger,
  PluginEndpointDiscovery,
  TokenManager,
} from '@backstage/backend-common';
import { ConfigReader } from '@backstage/config';
import { TestPipeline } from '@backstage/plugin-search-backend-node';
import { setupRequestMockHandlers } from '@backstage/backend-test-utils';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { Readable } from 'stream';
import { DefaultQetaCollatorFactory } from './DefaultQetaCollatorFactory';

const logger = getVoidLogger();

const mockComments = [{ content: 'comment' }];
const mockAnswers = [
  {
    id: 1,
    content: 'answer 1',
    comments: mockComments,
  },
];
const mockQuestions = {
  questions: [
    {
      id: 1,
      title: 'question1',
      content: 'question 1 content',
      answers: mockAnswers,
      comments: mockComments,
    },
  ],
};

describe('DefaultQetaCollatorFactory', () => {
  const config = new ConfigReader({});
  const mockDiscoveryApi: jest.Mocked<PluginEndpointDiscovery> = {
    getBaseUrl: jest.fn().mockResolvedValue('http://test-backend/api/qeta'),
    getExternalBaseUrl: jest.fn(),
  };
  const mockTokenManager: jest.Mocked<TokenManager> = {
    getToken: jest.fn().mockResolvedValue({ token: 'test_token' }),
    authenticate: jest.fn(),
  };
  const options = {
    discovery: mockDiscoveryApi,
    logger,
    tokenManager: mockTokenManager,
  };

  it('has expected type', () => {
    const factory = DefaultQetaCollatorFactory.fromConfig(config, options);
    expect(factory.type).toBe('qeta');
  });

  describe('getCollator', () => {
    let factory: DefaultQetaCollatorFactory;
    let collator: Readable;
    let lastRequest: any = null;

    const worker = setupServer();
    setupRequestMockHandlers(worker);

    beforeEach(async () => {
      factory = DefaultQetaCollatorFactory.fromConfig(config, options);
      collator = await factory.getCollator();
      lastRequest = null;

      worker.use(
        rest.get(
          'http://test-backend/api/qeta/questions',
          (req: any, res: any, ctx: any) => {
            lastRequest = req;
            return res(ctx.status(200), ctx.json(mockQuestions));
          },
        ),
      );
    });

    it('returns a readable stream', async () => {
      expect(collator).toBeInstanceOf(Readable);
    });

    it('runs against mock tools', async () => {
      const pipeline = TestPipeline.fromCollator(collator);
      const { documents } = await pipeline.execute();
      expect(mockDiscoveryApi.getBaseUrl).toHaveBeenCalledWith('qeta');
      const totalDocuments =
        mockQuestions.questions.length +
        mockQuestions.questions.length * mockAnswers.length +
        mockQuestions.questions.length * mockComments.length +
        mockAnswers.length * mockComments.length;
      expect(documents).toHaveLength(totalDocuments);
      expect(lastRequest.headers.get('authorization')).toEqual(
        'Bearer test_token',
      );
    });

    it('non-authenticated backend', async () => {
      factory = DefaultQetaCollatorFactory.fromConfig(config, {
        discovery: mockDiscoveryApi,
        logger,
      });
      collator = await factory.getCollator();

      const pipeline = TestPipeline.fromCollator(collator);
      const { documents } = await pipeline.execute();

      expect(mockDiscoveryApi.getBaseUrl).toHaveBeenCalledWith('qeta');
      const totalDocuments =
        mockQuestions.questions.length +
        mockQuestions.questions.length * mockAnswers.length +
        mockQuestions.questions.length * mockComments.length +
        mockAnswers.length * mockComments.length;
      expect(documents).toHaveLength(totalDocuments);
      expect(lastRequest.headers.get('authorization')).toEqual(null);
    });
  });
});