import { CacheService } from '@api/services/cache.service';

type RecoveryLayer = 'B' | 'C';
type CounterMetric = 'requested' | 'success' | 'failure';

type MetricsSnapshot = {
  counters: Record<RecoveryLayer, Record<CounterMetric, number>>;
  durationMsSum: Record<RecoveryLayer, number>;
  durationMsCount: Record<RecoveryLayer, number>;
};

export class ManualRecoveryMetricsService {
  private readonly metricsKey = 'instance:recovery:metrics:v1';
  private readonly cacheTtlSeconds = 7 * 24 * 60 * 60;
  private readonly fallbackSnapshot: MetricsSnapshot = {
    counters: {
      B: { requested: 0, success: 0, failure: 0 },
      C: { requested: 0, success: 0, failure: 0 },
    },
    durationMsSum: { B: 0, C: 0 },
    durationMsCount: { B: 0, C: 0 },
  };

  constructor(private readonly cacheService?: CacheService) {}

  private async loadSnapshot(): Promise<MetricsSnapshot> {
    const cached = (await this.cacheService?.get(this.metricsKey)) as MetricsSnapshot | undefined;
    if (cached) {
      return cached;
    }
    return structuredClone(this.fallbackSnapshot);
  }

  private async saveSnapshot(snapshot: MetricsSnapshot) {
    await this.cacheService?.set(this.metricsKey, snapshot, this.cacheTtlSeconds);
  }

  public async incrementCounter(layer: RecoveryLayer, metric: CounterMetric) {
    const snapshot = await this.loadSnapshot();
    snapshot.counters[layer][metric] += 1;
    await this.saveSnapshot(snapshot);
  }

  public async observeDuration(layer: RecoveryLayer, durationMs: number) {
    const snapshot = await this.loadSnapshot();
    snapshot.durationMsSum[layer] += Math.max(0, durationMs);
    snapshot.durationMsCount[layer] += 1;
    await this.saveSnapshot(snapshot);
  }

  public async getSnapshot(): Promise<MetricsSnapshot> {
    return this.loadSnapshot();
  }
}
