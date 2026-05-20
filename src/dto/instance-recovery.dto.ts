export class InstanceRecoveryDto {
  layer: 'B' | 'C';
  reason: string;
  force?: boolean;
  requestedBy?: string;
  confirmationAccepted?: boolean;
}
