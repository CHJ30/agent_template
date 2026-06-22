import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { RequirementService } from '../src/llm/requirement.service';
import type { RequirementResult } from '@autix/contracts';

const MOCK_RESULT: RequirementResult = {
  action: '绑定手机号',
  constraints: ['必须绑定手机号', '密码至少8位'],
  entities: ['用户', '手机号', '密码'],
};

describe('POST /requirement/extract', () => {
  let controller: AppController;
  let service: jest.Mocked<RequirementService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: RequirementService,
          useValue: { extract: jest.fn().mockResolvedValue(MOCK_RESULT) },
        },
      ],
    }).compile();

    controller = module.get(AppController);
    service = module.get(RequirementService);
  });

  it('delegates to RequirementService.extract with the given input', async () => {
    const input = '用户注册时必须绑定手机号，密码至少8位';
    const result = await controller.extractRequirement({ input });

    expect(service.extract).toHaveBeenCalledWith(input);
    expect(result).toEqual(MOCK_RESULT);
  });

  it('returns action / constraints / entities fields', async () => {
    const result = await controller.extractRequirement({ input: '任意输入' });

    expect(result).toHaveProperty('action');
    expect(result).toHaveProperty('constraints');
    expect(result).toHaveProperty('entities');
    expect(Array.isArray(result.constraints)).toBe(true);
    expect(Array.isArray(result.entities)).toBe(true);
  });
});
