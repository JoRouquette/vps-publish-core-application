import { PublishableNote } from '@core-domain/entities/PublishableNote';
import { ContentSanitizerPort } from '@core-domain/ports/content-sanitizer-port';
import { SanitizationRules } from '@core-domain/entities/SanitizationRules';
import { SanitizeMarkdownUseCase } from '../usecases/sanitize-markdown.usecase';

export class DefaultContentSanitizer implements ContentSanitizerPort {
  private readonly sanitizeMarkdown = new SanitizeMarkdownUseCase();

  sanitizeNote(
    note: PublishableNote,
    rules: SanitizationRules | null | undefined
  ): PublishableNote {
    if (!rules) {
      return note;
    }

    const { markdown } = this.sanitizeMarkdown.execute(note.content, rules);

    return {
      ...note,
      content: markdown,
    };
  }
}
