import { InstanceDto } from '@api/dto/instance.dto';
import { OperationTrace, OperationTraceRepository } from '@api/repository/operation-trace.repository';
import { CacheService } from '@api/services/cache.service';
import { Logger } from '@config/logger.config';
import { InstanceRecoveryDto } from '@dto/instance-recovery.dto';
import { ConflictException, NotFoundException } from '@exceptions';

export type RecoveryStatus = 'accepted' | 'running' | 'completed' | 'failed';

export type RecoveryResponse = {
  instanceName: string;
  layer: 'B' | 'C';
  status: RecoveryStatus;
  operationId: string;
};

type RecoveryHandlers = {
  hasInstance: (instanceName: string) => boolean;
  closeTransientSocketAndListeners?: (instance: InstanceDto) => Promise<unknown>;
  recreateProviderResources?: (instance: InstanceDto) => Promise<unknown>;
  reattachMandatoryListeners?: (instance: InstanceDto) => Promise<unknown>;
  restartInstance: (instance: InstanceDto) => Promise<unknown>;
  logout: (instance: InstanceDto) => Promise<unknown>;
  clearLocalCredentialsAndSession?: (instance: InstanceDto) => Promise<unknown>;
  connectToWhatsapp: (instance: InstanceDto) => Promise<unknown>;
};

type RecoveryLockMetadata = {
  instanceName: string;
  layer: 'B' | 'C';
  operationId: string;
  startedAt: string;
  reason?: string;
};

export class InstanceRecoveryService {
  private readonly logger = new Logger('InstanceRecoveryService');
  private readonly recoveryInProgress = new Map<string, RecoveryLockMetadata>();
  private readonly lockTtlSeconds = 15 * 60;

  constructor(
    private readonly cacheService?: CacheService,
    private readonly operationTraceRepository?: OperationTraceRepository,
  ) {}

  private createOperationId(instanceName: string, layer: 'B' | 'C') {
    return `${instanceName}:${layer}:${Date.now()}`;
  }

  private createLockKey(instanceName: string) {
    return `instance:recovery:lock:${instanceName}`;
  }

  private async acquireLock(instanceName: string, metadata: RecoveryLockMetadata) {
    const currentInMemoryLock = this.recoveryInProgress.get(instanceName);
    if (currentInMemoryLock) {
      return currentInMemoryLock;
    }

    const lockKey = this.createLockKey(instanceName);
    const currentCacheLock = (await this.cacheService?.get(lockKey)) as RecoveryLockMetadata | undefined;
    if (currentCacheLock) {
      this.recoveryInProgress.set(instanceName, currentCacheLock);
      return currentCacheLock;
    }

    this.recoveryInProgress.set(instanceName, metadata);
    await this.cacheService?.set(lockKey, metadata, this.lockTtlSeconds);
    return null;
  }

  private async releaseLock(instanceName: string) {
    this.recoveryInProgress.delete(instanceName);
    await this.cacheService?.delete(this.createLockKey(instanceName));
  }

  public async runLayerB(instance: InstanceDto, handlers: RecoveryHandlers) {
    await handlers.closeTransientSocketAndListeners?.(instance);
    await handlers.recreateProviderResources?.(instance);
    await handlers.restartInstance(instance);
    await handlers.reattachMandatoryListeners?.(instance);
  }

  public async runLayerC(instance: InstanceDto, handlers: RecoveryHandlers) {
    await handlers.logout(instance);
    await handlers.clearLocalCredentialsAndSession?.(instance);
    await handlers.connectToWhatsapp(instance);
  }

  public async executeManualRecovery(
    instance: InstanceDto,
    data: InstanceRecoveryDto,
    handlers: RecoveryHandlers,
  ): Promise<RecoveryResponse> {
    const { instanceName } = instance;

    if (!handlers.hasInstance(instanceName)) {
      throw new NotFoundException(`The "${instanceName}" instance does not exist`);
    }

    const operationId = this.createOperationId(instanceName, data.layer);
    const payload = { ...data, force: data.force ?? false };
    const lockMetadata: RecoveryLockMetadata = {
      instanceName,
      layer: payload.layer,
      operationId,
      startedAt: new Date().toISOString(),
      reason: payload.reason,
    };
    const currentLock = await this.acquireLock(instanceName, lockMetadata);
    if (currentLock) {
      throw new ConflictException({
        message: `Recovery is already in progress for instance "${instanceName}"`,
        operationInProgress: currentLock,
      });
    }

    const acceptedTrace: OperationTrace = {
      operationId,
      instanceName,
      layer: payload.layer,
      reason: payload.reason,
      requestedBy: 'manual',
      startedAt: lockMetadata.startedAt,
      status: 'accepted',
      result: 'Recovery accepted and queued',
    };
    await this.operationTraceRepository?.save(acceptedTrace);

    void this.processRecovery(instanceName, payload, operationId, handlers);

    return {
      instanceName,
      layer: payload.layer,
      status: 'accepted',
      operationId,
    };
  }

  private async processRecovery(
    instanceName: string,
    payload: InstanceRecoveryDto,
    operationId: string,
    handlers: RecoveryHandlers,
  ) {
    const runningTrace: OperationTrace = {
      operationId,
      instanceName,
      layer: payload.layer,
      reason: payload.reason,
      requestedBy: 'manual',
      startedAt: new Date().toISOString(),
      status: 'running',
    };
    await this.operationTraceRepository?.save(runningTrace);

    try {
      this.logger.info(
        `Starting recovery layer ${payload.layer} for instance ${instanceName} ` +
          `(force=${payload.force}) reason=${payload.reason} operationId=${operationId}`,
      );

      if (payload.layer === 'B') {
        await this.runLayerB({ instanceName }, handlers);
      }

      if (payload.layer === 'C') {
        await this.runLayerC({ instanceName }, handlers);
      }

      await this.operationTraceRepository?.save({
        ...runningTrace,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        result: 'Recovery completed successfully',
      });
      this.logger.info(`Recovery finished for ${instanceName} operationId=${operationId}`);
    } catch (error) {
      await this.operationTraceRepository?.save({
        ...runningTrace,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorMessage: error?.toString?.() || 'Unknown error',
      });
      this.logger.error(
        `Recovery failed for ${instanceName} operationId=${operationId}: ${error?.toString?.() || error}`,
      );
    } finally {
      await this.releaseLock(instanceName);
    }
  }

  public async getOperation(instance: InstanceDto, operationId: string) {
    const operation = await this.operationTraceRepository?.findByOperationId(operationId);
    if (!operation || operation.instanceName !== instance.instanceName) {
      throw new NotFoundException(`Operation ${operationId} not found for instance ${instance.instanceName}`);
    }

    return operation;
  }

  public async executeRecovery(instance: InstanceDto, data: InstanceRecoveryDto, handlers: RecoveryHandlers) {
    return this.executeManualRecovery(instance, data, handlers);
  }
}
