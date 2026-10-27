import { Logger } from '../common/logger';
import type { EmailProvider } from './interfaces';

const logger = new Logger('WelcomeEmail');

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  OPERATIONS_MANAGER: 'Operations Manager',
  OPERATIONS_STAFF: 'Operations Staff',
  MARKETING_HEAD: 'Marketing Head',
  MARKETING_STAFF: 'Marketing Staff',
  FINANCE_MANAGER: 'Finance Manager',
  FINANCE_STAFF: 'Finance Staff',
  CUSTOMER_SUPPORT: 'Customer Support',
  MERCHANT_OWNER: 'Merchant Owner',
  MERCHANT_MANAGER: 'Merchant Manager',
  ORDER_TAKING_STAFF: 'Order-Taking Staff',
  KITCHEN_STAFF: 'Kitchen Staff',
  BILLING_STAFF: 'Billing Staff',
  DELIVERY_STAFF: 'Delivery Staff',
  REPORT_VIEWER: 'Report Viewer',
};

export function roleLabel(key: string) {
  return roleLabels[key] ?? key.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function origin(port: number) {
  const listed = (process.env.WEB_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .find((item) => item.endsWith(`:${port}`));
  return (listed || `http://localhost:${port}`).replace(/\/$/, '');
}

export function adminSignInUrl() {
  return `${origin(3001)}/en/login`;
}

export function merchantSignInUrl() {
  return `${origin(3002)}/en/login`;
}

export function marketingSignInUrl() {
  return `${origin(3003)}/en/login`;
}

export function marketingInviteUrl(token: string) {
  return `${origin(3003)}/en/reset?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export async function sendWelcomeEmail(
  email: EmailProvider,
  input: { to: string; firstName: string; role: string; signInUrl: string; inviteUrl?: string | null; note?: string; subject?: string },
) {
  const name = input.firstName.trim() || 'there';
  const invite = input.inviteUrl
    ? `Set your password with this link (it expires in 7 days):\n${input.inviteUrl}`
    : `Sign in with the password that was set for your account:\n${input.signInUrl}`;
  const note = input.note ? `\n\n${input.note}` : '';
  const text = `Hello ${name},\n\nWelcome to Alliva. Your ${input.role} account is ready.\n\n${invite}${note}\n\n— Alliva`;
  const action = input.inviteUrl
    ? `<p>Set your password with the link below. It expires in 7 days.</p><p><a href="${escapeHtml(input.inviteUrl)}">Set your password</a></p>`
    : `<p>Sign in with the password that was set for your account.</p><p><a href="${escapeHtml(input.signInUrl)}">Sign in to Alliva</a></p>`;
  const html = `<div style="font-family:sans-serif;line-height:1.5;color:#111"><p>Hello ${escapeHtml(name)},</p><p>Welcome to Alliva. Your <strong>${escapeHtml(input.role)}</strong> account is ready.</p>${action}${input.note ? `<p>${escapeHtml(input.note)}</p>` : ''}<p>— Alliva</p></div>`;
  try {
    await email.send(input.to, input.subject ?? 'Welcome to Alliva', text, html);
  } catch (error) {
    logger.error(`Welcome email to ${input.to} failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}
