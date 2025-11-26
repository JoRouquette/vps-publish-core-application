import { PublishableNote } from '@core-domain/entities/publishable-note';
import { ContentSanitizerPort } from '@core-domain/ports/content-sanitizer-port';
import { SanitizationRules } from '@core-domain/entities/sanitization-rules';

export class ContentSanitizerService implements ContentSanitizerPort {
  constructor() {}

  async sanitize(
    note: PublishableNote,
    rules: SanitizationRules | undefined
  ): Promise<PublishableNote> {
    if (!rules) {
      return note;
    }

    return {
      ...note,
      content: '',
    };
  }
}
