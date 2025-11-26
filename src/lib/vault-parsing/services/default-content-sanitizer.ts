import { PublishableNote } from '@core-domain/entities/publishable-note';
import { ContentSanitizerPort } from '@core-domain/ports/content-sanitizer-port';
import { SanitizationRules } from '@core-domain/entities/sanitization-rules';
import { SanitizeMarkdownQuery } from '../queries/sanitize-markdown.query';

export class DefaultContentSanitizer implements ContentSanitizerPort {
  private readonly sanitizeMarkdown = new SanitizeMarkdownQuery();

  sanitizeNote(
    note: PublishableNote,
    rules: SanitizationRules | null | undefined
  ): PublishableNote {
    if (!rules) {
      return note;
    }

    const { markdown } = this.sanitizeMarkdown.handle({ markdown: note.content, rules });

    return {
      ...note,
      content: markdown,
    };
  }
}
