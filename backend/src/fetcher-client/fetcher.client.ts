import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG_TOKEN } from '../common/config/configuration';

export interface MetadataResult {
  status: 'OK' | 'PARTIAL' | 'FAILED';
  canonicalUrl?: string;
  httpStatus?: number;
  metadata?: Record<string, string>;
  redirects?: string[];
  error?: string;
}

/**
 * Klien menuju Metadata Fetcher.
 *
 * Backend tidak pernah membuka koneksi ke URL target secara langsung; seluruh
 * pengambilan diserahkan ke layanan terisolasi di zona restricted egress
 * (BRD 4.2). Kegagalan pengambilan bukan kegagalan pembuatan report — user
 * tetap dapat melanjutkan dengan konfirmasi manual (BRD 4.2 poin 9).
 */
@Injectable()
export class FetcherClient {
  private readonly logger = new Logger(FetcherClient.name);

  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  async fetchMetadata(url: string, allowedDomains: string[]): Promise<MetadataResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(`${this.config.fetcher.url}/fetch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.config.fetcher.serviceToken,
        },
        body: JSON.stringify({ url, allowedDomains }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { status: 'FAILED', error: `Metadata Fetcher menjawab ${response.status}` };
      }

      return (await response.json()) as MetadataResult;
    } catch (error) {
      this.logger.warn(`Metadata Fetcher tidak dapat dihubungi: ${(error as Error).message}`);
      return {
        status: 'FAILED',
        error: 'Layanan pengambil metadata sedang tidak tersedia.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.fetcher.url}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
