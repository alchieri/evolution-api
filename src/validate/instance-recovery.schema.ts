import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const instanceRecoverySchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    layer: {
      type: 'string',
      enum: ['B', 'C'],
      description: 'The "layer" must be "B" (hard reconnect) or "C" (session recycle)',
    },
    reason: {
      type: 'string',
      minLength: 5,
      maxLength: 120,
      description: 'The "reason" is required for audit and must be a short string',
    },
    force: { type: 'boolean' },
  },
  required: ['layer', 'reason'],
  additionalProperties: false,
};
