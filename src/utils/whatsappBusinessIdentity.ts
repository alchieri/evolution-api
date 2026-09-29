import { createJid } from './createJid';

export const isBusinessScopedUserId = (value?: string): boolean => /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/.test(value || '');

export const businessRecipient = (value: string): { recipient: string } | { to: string } => {
  const recipient = value.trim();
  if (isBusinessScopedUserId(recipient)) return { recipient };
  if (/[A-Za-z]/.test(recipient.replace(/@(s\.whatsapp\.net|c\.us)$/, ''))) throw new Error('Invalid WhatsApp recipient');
  return { to: recipient.replace(/\D/g, '') };
};

// BSUID is already a provider identity, not a phone number or a Baileys JID.
export const businessRemoteId = (value: string): string => isBusinessScopedUserId(value) ? value : createJid(value);
