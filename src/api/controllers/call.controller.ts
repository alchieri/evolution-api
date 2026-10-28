import { OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { WAMonitoringService } from '@api/services/monitor.service';
import { NotFoundException } from '@exceptions';
import { callingCapabilities } from '@utils/call-events';

export class CallController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async capabilities({ instanceName }: InstanceDto) {
    if (!this.waMonitor.waInstances[instanceName]) throw new NotFoundException('Instância não encontrada.');
    return {
      ...callingCapabilities,
      observedEvents: this.waMonitor.waInstances[instanceName].integration === 'WHATSAPP-BAILEYS',
    };
  }

  public async offerCall({ instanceName }: InstanceDto, data: OfferCallDto) {
    return await this.waMonitor.waInstances[instanceName].offerCall(data);
  }
}
