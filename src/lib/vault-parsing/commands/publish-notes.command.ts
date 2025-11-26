import type { CollectedNote } from '@core-domain/entities/collected-note';
import type { FolderConfig } from '@core-domain/entities/folder-config';
import type { PublishPluginSettings } from '@core-domain/entities/publish-plugin-settings';
import type { PublishableNote } from '@core-domain/entities/publishable-note';
import type { ContentSanitizerPort } from '@core-domain/ports/content-sanitizer-port';
import type { GuidGeneratorPort } from '@core-domain/ports/guid-generator-port';
import { LogLevel, type LoggerPort } from '@core-domain/ports/logger-port';
import type { ProgressPort } from '@core-domain/ports/progress-port';
import type { UploaderPort } from '@core-domain/ports/uploader-port';
import type { VaultPort } from '@core-domain/ports/vault-port';

import { CommandHandler } from '../../common/command-handler';
import { ContentSanitizerService } from '../services/content-sanitizer.service';
import { ComputeRoutingQuery } from '../requests/compute-routing.request';
import { DetectAssetsQuery } from '../requests/detect-assets.request';
import { DetectWikilinksQuery } from '../requests/detect-wikilinks.request';
import { EvaluateIgnoreRulesQuery } from '../requests/evaluate-ignore-rules.request';
import { NormalizeFrontmatterQuery } from '../requests/normalize-frontmatter.request';
import { RenderInlineDataviewQuery } from '../requests/render-inline-dataview.request';

export type PublicationResult =
  | { type: 'success'; publishedCount: number; notes: PublishableNote[] }
  | { type: 'noConfig' }
  | { type: 'missingVpsConfig'; foldersWithoutVps: string[] }
  | { type: 'error'; error: unknown };

export interface PublishNotesCommand {
  settings: PublishPluginSettings;
  progress?: ProgressPort;
}

/**
 * Orchestrateur principal de composition de notes et d'envoi.
 */
export class PublishNotesCommandHandler
  implements CommandHandler<PublishNotesCommand, PublicationResult>
{
  private readonly normalizeFrontmatter: NormalizeFrontmatterQuery;
  private readonly evaluateIgnoreRules: EvaluateIgnoreRulesQuery;
  private readonly detectAssets: DetectAssetsQuery;
  private readonly detectWikilinks: DetectWikilinksQuery;
  private readonly computeRouting: ComputeRoutingQuery;
  private readonly renderInlineDataview: RenderInlineDataviewQuery;

  constructor(
    private readonly vaultPort: VaultPort<CollectedNote[]>,
    private readonly uploaderPort: UploaderPort,
    private readonly guidGenerator: GuidGeneratorPort,
    private readonly logger: LoggerPort,
    private readonly contentSanitizer: ContentSanitizerPort = new ContentSanitizerService()
  ) {
    this.logger = logger.child({ usecase: 'PublishToSiteUseCase' }, LogLevel.debug);
    this.logger.debug('PublishToSiteUseCase initialized');

    this.normalizeFrontmatter = new NormalizeFrontmatterQuery(logger);
    this.evaluateIgnoreRules = new EvaluateIgnoreRulesQuery(logger);
    this.detectAssets = new DetectAssetsQuery(logger);
    this.detectWikilinks = new DetectWikilinksQuery(logger);
    this.computeRouting = new ComputeRoutingQuery(logger);
    this.renderInlineDataview = new RenderInlineDataviewQuery(logger);
  }

  async execute(command: PublishNotesCommand): Promise<PublicationResult> {
    const { settings, progress } = command;
    this.logger.info('Starting publish-to-site execution');

    if (!settings?.vpsConfigs?.length || !settings?.folders?.length) {
      this.logger.warn('No VPS configs or folders found in settings');
      return { type: 'noConfig' };
    }

    const vpsById = new Map<string, any>();
    for (const vps of settings.vpsConfigs) {
      if (vps && vps.id) vpsById.set(vps.id, vps);
    }

    const missingVps: string[] = [];
    const collected: Array<{
      vaultPath: string;
      relativePath: string;
      content: string;
      frontmatter: Record<string, unknown>;
      folder: FolderConfig;
      vpsConfig: any;
    }> = [];

    for (const folder of settings.folders) {
      const vpsConfig = vpsById.get(folder.vpsId);
      if (!vpsConfig) {
        this.logger.warn('Missing VPS config for folder', {
          folderId: folder.id,
          vpsId: folder.vpsId,
        });
        missingVps.push(folder.id);
        continue;
      }

      this.logger.debug('Collecting notes from folder', { folderId: folder.id });
      const notes = await this.vaultPort.collectFromFolder(folder);
      for (const n of notes) {
        collected.push({
          vaultPath: n.vaultPath,
          relativePath: n.relativePath,
          content: n.content,
          frontmatter: n.frontmatter ?? {},
          folder,
          vpsConfig,
        });
      }
    }

    if (missingVps.length > 0) {
      this.logger.error('Some folders are missing VPS configs', {
        missingVps,
      });
      return { type: 'missingVpsConfig', foldersWithoutVps: missingVps };
    }

    if (collected.length === 0) {
      this.logger.info('No notes collected for publishing');
      progress?.start(0);
      progress?.finish();
      return { type: 'success', publishedCount: 0, notes: [] };
    }

    progress?.start(collected.length);
    this.logger.info('Collected notes', { count: collected.length });

    const publishable: PublishableNote[] = [];

    for (const raw of collected) {
      const notePipelineLogger = this.logger.child(
        { step: 'notePipeline', note: raw.vaultPath },
        this.logger.level
      );

      const domainFrontmatter = this.normalizeFrontmatter.execute(raw.frontmatter);

      notePipelineLogger.debug('Normalized frontmatter', {
        vaultPath: raw.vaultPath,
        frontmatter: domainFrontmatter,
      });

      const eligibility = this.evaluateIgnoreRules.execute({
        frontmatter: domainFrontmatter,
        rules: settings.ignoreRules ?? null,
      });
      notePipelineLogger.debug('Ignore rules evaluation', {
        vaultPath: raw.vaultPath,
        eligibility,
      });

      if (!eligibility.isPublishable) {
        notePipelineLogger.debug('Note ignored by rules', {
          vaultPath: raw.vaultPath,
        });
        progress?.advance(1);
        continue;
      }

      let note: PublishableNote = {
        noteId: this.guidGenerator.generateGuid(),
        title: this.extractFileNameWithoutExt(raw.vaultPath),
        vaultPath: raw.vaultPath,
        relativePath: raw.relativePath,
        content: raw.content,
        frontmatter: domainFrontmatter,
        folderConfig: raw.folder,
        vpsConfig: raw.vpsConfig,
        publishedAt: new Date(),
        routing: {
          id: '',
          slug: '',
          path: '',
          routeBase: '',
          fullPath: '',
        },
      };

      note = this.renderInlineDataview.execute(note);
      note = this.contentSanitizer.sanitize(note, raw.folder.sanitization);
      note = this.detectAssets.execute(note);
      note = this.detectWikilinks.execute(note);
      note = this.computeRouting.execute(note);

      notePipelineLogger.debug(`Note ${note.title} ready for publishing.`);
      notePipelineLogger.debug(JSON.stringify(note, null, 2));

      publishable.push(note);
      progress?.advance(1);
    }

    if (publishable.length === 0) {
      this.logger.info('No publishable notes after filtering');
      progress?.finish();
      return { type: 'success', publishedCount: 0, notes: [] };
    }

    const byVps = new Map<string, PublishableNote[]>();
    for (const note of publishable) {
      const key = note.vpsConfig.id;
      const bucket = byVps.get(key);
      if (!bucket) {
        byVps.set(key, [note]);
      } else {
        bucket.push(note);
      }
    }

    let publishedCount = 0;

    try {
      for (const [vpsId, notes] of byVps.entries()) {
        this.logger.info('Uploading notes to VPS', {
          vpsId,
          noteCount: notes.length,
        });
        const success = await this.uploaderPort.upload(notes);

        if (!success) {
          this.logger.error('Failed to upload notes to VPS', { vpsId });
          throw new Error(`Upload failed for VPS ID ${vpsId}`);
        }

        publishedCount += notes.length;
      }

      this.logger.info('Publishing completed successfully', {
        publishedCount,
      });
      progress?.finish();

      return { type: 'success', publishedCount, notes: publishable };
    } catch (error) {
      this.logger.error('Error during publishing', error);
      progress?.finish();
      return { type: 'error', error };
    }
  }

  private extractFileNameWithoutExt(path: string): string {
    const parts = path.split('/');
    const fileName = parts[parts.length - 1];
    const dotIndex = fileName.lastIndexOf('.');

    if (dotIndex === -1) {
      return fileName;
    }

    return fileName.substring(0, dotIndex);
  }
}
