import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto, SetPresenceDto } from '@api/dto/instance.dto';
import { instanceController, instanceRecoveryController } from '@api/server.module';
import { ConfigService } from '@config/env.config';
import { InstanceRecoveryDto } from '@dto/instance-recovery.dto';
import { BadRequestException, ForbiddenException } from '@exceptions';
import { instanceRecoverySchema, instanceSchema, presenceOnlySchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class InstanceRouter extends RouterBroker {
  constructor(
    readonly configService: ConfigService,
    ...guards: RequestHandler[]
  ) {
    super();
    this.router
      .post('/create', ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.createInstance(instance),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('restart'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.restartInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('recovery'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceRecoveryDto>({
          request: req,
          schema: instanceRecoverySchema,
          ClassRef: InstanceRecoveryDto,
          execute: (instance, data) => {
            if (req.authInfo?.scope === 'instance' && req.authInfo.instanceName !== instance.instanceName) {
              throw new ForbiddenException('API key scope does not match target instance');
            }

            const confirmationHeader = req.get('x-recovery-confirmation');
            const requiresConfirmation = data.layer === 'C';
            const confirmationAccepted =
              !requiresConfirmation || confirmationHeader === 'CONFIRM_LAYER_C' || confirmationHeader === 'true';

            if (requiresConfirmation && !confirmationAccepted) {
              throw new BadRequestException(
                'Layer C operation requires confirmation header',
                'Set header x-recovery-confirmation=true (or CONFIRM_LAYER_C) to continue',
              );
            }

            return instanceRecoveryController.executeRecovery(instance, {
              ...data,
              requestedBy: req.authInfo?.requestedBy || 'unknown-apikey',
              confirmationAccepted,
            });
          },
        });

        return res.status(HttpStatus.ACCEPTED).json(response);
      })
      .get(this.routerPath('recovery/:operationId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<null>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceRecoveryController.getRecoveryOperation(instance, req.params.operationId),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connect'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectToWhatsapp(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('connectionState'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.connectionState(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchInstances', false), ...guards, async (req, res) => {
        const key = req.get('apikey');

        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.fetchInstances(instance, key),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('setPresence'), ...guards, async (req, res) => {
        const response = await this.dataValidate<null>({
          request: req,
          schema: presenceOnlySchema,
          ClassRef: SetPresenceDto,
          execute: (instance, data) => instanceController.setPresence(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .delete(this.routerPath('logout'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.logout(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: null,
          ClassRef: InstanceDto,
          execute: (instance) => instanceController.deleteInstance(instance),
        });

        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
