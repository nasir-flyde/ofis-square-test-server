import nodemailer from 'nodemailer';
import { SendMailClient } from "zeptomail";

class EmailProvider {
  constructor() {
    this.name = 'nodemailer';
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async send(options) {
    try {
      const { toEmail, subject, html, text } = options;
      console.log(`[EmailProvider:send] Sending to ${toEmail} with ${options.attachments?.length || 0} attachments`);

      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP credentials not configured');
      }

      const mailOptions = {
        from: `"${process.env.SMTP_FROM_NAME || 'Ofis Square'}" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: subject,
        html: html,
        text: text || this.stripHtml(html)
      };

      if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments;
      }

      const info = await this.transporter.sendMail(mailOptions);

      return {
        success: true,
        providerMessageId: info.messageId,
        providerResponse: {
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response
        }
      };
    } catch (error) {
      console.error('Email Provider Error:', error);
      return {
        success: false,
        error: error.message,
        errorCode: error.code || 'EMAIL_ERROR',
        providerResponse: error
      };
    }
  }

  stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

class ZeptoMailProvider {
  constructor() {
    this.name = 'zeptomail';
    this.client = new SendMailClient({
      url: process.env.ZEPTOMAIL_URL || "https://api.zeptomail.in/v1.1/email",
      token: process.env.ZEPTOMAIL_TOKEN,
    });
    this.fromAddress = process.env.ZEPTOMAIL_FROM_ADDRESS || "hello@ofisspaces.com";
    this.fromName = process.env.ZEPTOMAIL_FROM_NAME || "Ofis Square";
  }

  async send(options) {
    const { toEmail, subject, html, text } = options;
    try {
      console.log(`[ZeptoMailProvider:send] Sending to ${toEmail} with ${options.attachments?.length || 0} attachments`);
      if (options.attachments && options.attachments.length > 0) {
        options.attachments.forEach((att, idx) => {
          try {
            const b64 = att.content.toString('base64');
            console.log(`[ZeptoMailProvider] Attachment ${idx}: Name=${att.filename}, Base64Len=${b64.length}, Start=${b64.substring(0, 50)}...`);
          } catch (e) { console.error(`[ZeptoMailProvider] Error logging attachment ${idx}:`, e); }
        });
      }
      const mailPayload = {
        "from": {
          "address": this.fromAddress,
          "name": this.fromName
        },
        "to": [
          {
            "email_address": {
              "address": toEmail
            }
          }
        ],
        "subject": subject,
        "htmlbody": html || (text ? text.replace(/\n/g, '<br/>') : 'No content')
      };

      if (options.attachments && options.attachments.length > 0) {
        mailPayload.attachments = options.attachments.map(att => ({
          content: att.content.toString('base64'),
          mime_type: att.contentType || 'application/pdf',
          name: att.filename
        }));
      }

      const result = await this.client.sendMail(mailPayload);

      return {
        success: true,
        providerMessageId: result?.data?.[0]?.messageId || 'zepto-sent',
        providerResponse: result
      };
    } catch (error) {
      console.error('ZeptoMail Provider Error:', error);
      return {
        success: false,
        error: error.message,
        errorCode: 'ZEPTO_ERROR',
        providerResponse: error
      };
    }
  }

  async verifyConnection() {
    return { success: true };
  }

  stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

// Mock provider for testing
class MockEmailProvider {
  constructor() {
    this.name = 'mock';
  }

  async send({ toEmail, subject, html, text }) {
    console.log(`[MOCK EMAIL] To: ${toEmail}, Subject: ${subject}`);
    console.log(`[MOCK EMAIL] Content: ${text || html}`);
    const success = Math.random() > 0.05;

    if (success) {
      return {
        success: true,
        providerMessageId: `mock_email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        providerResponse: { status: 'sent', mock: true }
      };
    } else {
      return {
        success: false,
        error: 'Mock email failure for testing',
        errorCode: 'MOCK_ERROR',
        providerResponse: { status: 'failed', mock: true }
      };
    }
  }

  async verifyConnection() {
    return { success: true, mock: true };
  }
}

export const getEmailProvider = () => {
  const useMock = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_EMAIL === 'true';
  if (useMock) return new MockEmailProvider();

  if (process.env.ZEPTOMAIL_TOKEN) {
    return new ZeptoMailProvider();
  }

  return new EmailProvider();
};

export { EmailProvider, ZeptoMailProvider, MockEmailProvider };
