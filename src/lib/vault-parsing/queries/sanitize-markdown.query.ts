import type { SanitizationRules } from '@core-domain';
import { QueryHandler } from '../../common/query-handler';

export interface SanitizeMarkdownOutput {
  markdown: string;
}

export interface SanitizeMarkdownRequest {
  markdown: string;
  rules: SanitizationRules | null | undefined;
}

const FENCED_CODE_BLOCK_REGEX = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;

export class SanitizeMarkdownQuery
  implements QueryHandler<SanitizeMarkdownRequest, SanitizeMarkdownOutput>
{
  constructor(private readonly rules: SanitizationRules | null | undefined) {}

  async handle(request: SanitizeMarkdownRequest): Promise<SanitizeMarkdownOutput> {
    if (!this.rules) {
      return { markdown: request.markdown };
    }

    let result = request.markdown;

    for (const [rule, isEnabled] of Object.entries(this.rules)) {
      if (!isEnabled) {
        continue;
      }

      throw new Error(`Sanitization rule "${rule}" is not implemented.`);
    }

    return { markdown: result };
  }
}
