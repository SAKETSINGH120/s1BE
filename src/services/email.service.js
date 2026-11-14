import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

async function sendEmail({ to, subject, text }) {
  // Without SMTP (development only; production requires it) emails are printed to the console.
  if (!transporter) {
    console.info(`[email] To: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return;
  }
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text });
}

export async function sendPasswordResetEmail(to, resetUrl) {
  await sendEmail({
    to,
    subject: 'Reset your Relay password',
    text: [
      'We received a request to reset your Relay password.',
      `Open this link within ${env.PASSWORD_RESET_TTL_MINUTES} minutes to choose a new one:`,
      resetUrl,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
  });
}
