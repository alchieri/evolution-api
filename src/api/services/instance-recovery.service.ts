import { InstanceDto } from '@api/dto/instance.dto';
import { Logger } from '@config/logger.config';
import { InstanceRecoveryDto } from '@dto/instance-recovery.dto';
import { ConflictException, InternalServerErrorException, NotFoundException } from '@exceptions';

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

export class InstanceRecoveryService {
  private readonly logger = new Logger('InstanceRecoveryService');
  private readonly recoveryInProgress = new Set<string>();

  private createOperationId(instanceName: string, layer: 'B' | 'C') {
    return `${instanceName}:${layer}:${Date.now()}`;
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
    const executionKey = `${instanceName}:${payload.layer}`;

    if (this.recoveryInProgress.has(executionKey)) {
      throw new ConflictException(`Recovery is already in progress for instance "${instanceName}"`);
    }
    this.recoveryInProgress.add(executionKey);
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

      this.logger.info(`Recovery finished for ${instanceName} operationId=${operationId}`);
    } catch (error) {
      this.logger.error(
        `Recovery failed for ${instanceName} operationId=${operationId}: ${error?.toString?.() || error}`,
      );
      throw new InternalServerErrorException(`Recovery operation failed (${operationId})`, error);
    } finally {
      this.recoveryInProgress.delete(executionKey);
    }

    return {
      instanceName,
      layer: payload.layer,
      status: 'completed',
      operationId,
    };
  }

  public async executeRecovery(instance: InstanceDto, data: InstanceRecoveryDto, handlers: RecoveryHandlers) {
    return this.executeManualRecovery(instance, data, handlers);
  }
}
