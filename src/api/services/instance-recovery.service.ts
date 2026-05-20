import { InstanceDto } from '@api/dto/instance.dto';
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
  restartInstance: (instance: InstanceDto) => Promise<unknown>;
  logout: (instance: InstanceDto) => Promise<unknown>;
  connectToWhatsapp: (instance: InstanceDto) => Promise<unknown>;
};

export class InstanceRecoveryService {
  private readonly logger = new Logger('InstanceRecoveryService');
  private readonly recoveryInProgress = new Set<string>();

  public async executeRecovery(
    { instanceName }: InstanceDto,
    data: InstanceRecoveryDto,
    handlers: RecoveryHandlers,
  ): Promise<RecoveryResponse> {
    if (!handlers.hasInstance(instanceName)) {
      throw new NotFoundException(`The "${instanceName}" instance does not exist`);
    }

    if (this.recoveryInProgress.has(instanceName)) {
      throw new ConflictException(`Recovery is already in progress for instance "${instanceName}"`);
    }

    const operationId = `${instanceName}:${Date.now()}`;
    const payload = { ...data, force: data.force ?? false };
    this.recoveryInProgress.add(instanceName);

    void (async () => {
      try {
        this.logger.info(
          `Starting recovery layer ${payload.layer} for instance ${instanceName} ` +
            `(force=${payload.force}) reason=${payload.reason} operationId=${operationId}`,
        );

        if (payload.layer === 'B') {
          await handlers.restartInstance({ instanceName });
        } else {
          await handlers.logout({ instanceName });
          await handlers.connectToWhatsapp({ instanceName });
        }
      } catch (error) {
        this.logger.error(
          `Recovery failed for ${instanceName} operationId=${operationId}: ${error?.toString?.() || error}`,
        );
      } finally {
        this.recoveryInProgress.delete(instanceName);
      }
    })();

    return {
      instanceName,
      layer: payload.layer,
      status: 'accepted',
      operationId,
    };
  }
}
