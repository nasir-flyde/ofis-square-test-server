import dotenv from 'dotenv';
import { SendMailClient } from "zeptomail";

dotenv.config();

// Initialize ZeptoMail client
const zeptoClient = new SendMailClient({
  url: process.env.ZEPTOMAIL_URL || "https://api.zeptomail.in/v1.1/email",
  token: process.env.ZEPTOMAIL_TOKEN,
});

const getWelcomeEmailTemplate = (clientData) => {
  const { companyName, contactPerson, email } = clientData;

  return {
    subject: `Welcome to Ofis Square - ${companyName || 'Your Company'}!`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Ofis Square</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .welcome-box { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .feature-list { list-style: none; padding: 0; }
          .feature-list li { padding: 10px 0; border-bottom: 1px solid #eee; }
          .feature-list li:before { content: "✓"; color: #28a745; font-weight: bold; margin-right: 10px; }
          .cta-button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏢 Welcome to Ofis Square!</h1>
            <p>Your premium workspace solution</p>
          </div>
          
          <div class="content">
            <div class="welcome-box">
              <h2>Hello ${contactPerson || 'there'}! 👋</h2>
              <p>We're thrilled to welcome <strong>${companyName || 'your company'}</strong> to the Ofis Square family!</p>
              
              <p>You've just joined a community of innovative businesses who choose Ofis Square for their workspace needs. We're committed to providing you with an exceptional experience.</p>
            </div>
            
            <div class="welcome-box">
              <h3>🚀 What's Next?</h3>
              <ul class="feature-list">
                <li>Complete your KYC verification process</li>
                <li>Review and sign your workspace contract</li>
                <li>Schedule a tour of your allocated space</li>
                <li>Set up your team members and access</li>
                <li>Explore our premium amenities</li>
              </ul>
            </div>
            
            <div class="welcome-box">
              <h3>📞 Need Help?</h3>
              <p>Our dedicated support team is here to assist you:</p>
              <ul>
                <li><strong>Email:</strong> support@ofissquare.com</li>
                <li><strong>Phone:</strong> +91-XXXX-XXXXXX</li>
                <li><strong>Hours:</strong> Monday - Friday, 9 AM - 6 PM</li>
              </ul>
            </div>
            
            <div style="text-align: center;">
              <a href="#" class="cta-button">Access Your Dashboard</a>
            </div>
          </div>
          
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
            <p>This email was sent to ${email}</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
      Welcome to Ofis Square!

      Hello ${contactPerson || 'there'}!

      We're thrilled to welcome ${companyName || 'your company'} to the Ofis Square family!

      What's Next:
      - Complete your KYC verification process
      - Review and sign your workspace contract  
      - Schedule a tour of your allocated space
      - Set up your team members and access
      - Explore our premium amenities

      Need Help?
      Email: support@ofissquare.com
      Phone: +91-XXXX-XXXXXX
      Hours: Monday - Friday, 9 AM - 6 PM

      © 2024 Ofis Square. All rights reserved.
    `
  };
};

// Send welcome email function
export const sendWelcomeEmail = async (clientData) => {
  try {
    const emailTemplate = getWelcomeEmailTemplate(clientData);

    // If ZeptoMail is configured, use it
    if (!process.env.ZEPTOMAIL_TOKEN) {
      console.warn('ZEPTOMAIL_TOKEN not found in environment variables. Email will not be sent.');
      return { success: false, error: 'ZeptoMail token missing' };
    }

    const result = await zeptoClient.sendMail({
      "from": {
        "address": process.env.ZEPTOMAIL_FROM_ADDRESS || "hello@ofisspaces.com",
        "name": process.env.ZEPTOMAIL_FROM_NAME || "noreply"
      },
      "to": [
        {
          "email_address": {
            "address": clientData.email,
            "name": clientData.contactPerson || clientData.companyName || "Client"
          }
        }
      ],
      "subject": emailTemplate.subject,
      "htmlbody": emailTemplate.html,
    });

    console.log('Welcome email sent successfully via ZeptoMail to:', clientData.email);
    return { success: true, messageId: result?.config?.messageId || 'zepto-sent' };

  } catch (error) {
    console.error('Error sending welcome email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Test email function for debugging
export const sendTestEmail = async (to, subject = 'Test Email') => {
  try {
    console.log(`📧 TEST EMAIL: Sending to ${to} with subject "${subject}"`);
    return { success: true, demo: true, message: 'Test email logged' };
  } catch (error) {
    console.error('Error sending test email:', error);
    return { success: false, error: error.message };
  }
};
