import { InstanceDto } from '@api/dto/instance.dto';
import { InstanceRecoveryDto } from '@dto/instance-recovery.dto';

import { InstanceRecoveryService, RecoveryResponse } from '../services/instance-recovery.service';

export class InstanceRecoveryController {
  constructor(private readonly instanceRecoveryService: InstanceRecoveryService) {}

  public async executeRecovery(instance: InstanceDto, data: InstanceRecoveryDto): Promise<RecoveryResponse> {
    return this.instanceRecoveryService.executeRecovery(instance, data, {
      hasInstance: (instanceName) => Boolean(this.instanceRecoveryServiceContext.waInstances[instanceName]),
      restartInstance: (instanceDto) => this.instanceRecoveryServiceContext.restartInstance(instanceDto),
      logout: (instanceDto) => this.instanceRecoveryServiceContext.logout(instanceDto),
      connectToWhatsapp: (instanceDto) => this.instanceRecoveryServiceContext.connectToWhatsapp(instanceDto),
    });
  }

  private instanceRecoveryServiceContext: {
    waInstances: Record<string, unknown>;
    restartInstance: (instance: InstanceDto) => Promise<unknown>;
    logout: (instance: InstanceDto) => Promise<unknown>;
    connectToWhatsapp: (instance: InstanceDto) => Promise<unknown>;
  };

  public setContext(context: InstanceRecoveryController['instanceRecoveryServiceContext']) {
    this.instanceRecoveryServiceContext = context;
  }
}
