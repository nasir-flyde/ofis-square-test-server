import nodemailer from 'nodemailer';

class EmailProvider {
  constructor() {
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
  
  async send({ toEmail, subject, html, text }) {
    try {
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

// Mock provider for testing
class MockEmailProvider {
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

// Factory function to get the appropriate provider
export const getEmailProvider = () => {
  const useMock = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_EMAIL === 'true';
  return useMock ? new MockEmailProvider() : new EmailProvider();
};

export { EmailProvider, MockEmailProvider };
