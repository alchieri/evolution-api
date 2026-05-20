import { CacheService } from '@api/services/cache.service';

export type OperationStatus = 'accepted' | 'running' | 'completed' | 'failed';

export type OperationTrace = {
  operationId: string;
  instanceName: string;
  layer: 'B' | 'C';
  reason: string;
  requestedBy?: string;
  startedAt: string;
  finishedAt?: string;
  status: OperationStatus;
  result?: string;
  errorMessage?: string;
};

export class OperationTraceRepository {
  private readonly inMemoryStore = new Map<string, OperationTrace>();
  private readonly ttlSeconds = 24 * 60 * 60;

  constructor(private readonly cacheService?: CacheService) {}

  private operationKey(operationId: string) {
    return `instance:recovery:operation:${operationId}`;
  }

  public async save(trace: OperationTrace): Promise<OperationTrace> {
    this.inMemoryStore.set(trace.operationId, trace);
    await this.cacheService?.set(this.operationKey(trace.operationId), trace, this.ttlSeconds);
    return trace;
  }

  public async findByOperationId(operationId: string): Promise<OperationTrace | null> {
    const memoryValue = this.inMemoryStore.get(operationId);
    if (memoryValue) {
      return memoryValue;
    }

    const cacheValue = (await this.cacheService?.get(this.operationKey(operationId))) as OperationTrace | undefined;
    if (!cacheValue) {
      return null;
    }

    this.inMemoryStore.set(operationId, cacheValue);
    return cacheValue;
  }

  public async findByOperationIdAndInstanceName(
    operationId: string,
    instanceName: string,
  ): Promise<OperationTrace | null> {
    const operation = await this.findByOperationId(operationId);
    if (!operation || operation.instanceName !== instanceName) {
      return null;
    }

    return operation;
  }
}
