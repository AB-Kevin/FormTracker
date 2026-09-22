"use strict";

const nodemailer = require("nodemailer");

function createTransport(smtpConfig) {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: Number(smtpConfig.port) || 587,
    secure: !!smtpConfig.secure,
    auth: { user: smtpConfig.user, pass: smtpConfig.password },
  });
}

async function verifyConnection(smtpConfig) {
  const transport = createTransport(smtpConfig);
  await transport.verify();
  return true;
}

async function sendMail(smtpConfig, { to, subject, text, html, attachments }) {
  const transport = createTransport(smtpConfig);
  const from = smtpConfig.fromName ? `"${smtpConfig.fromName}" <${smtpConfig.fromEmail || smtpConfig.user}>` : smtpConfig.fromEmail || smtpConfig.user;
  return transport.sendMail({ from, to, subject, text, html, attachments });
}

module.exports = { createTransport, verifyConnection, sendMail };
