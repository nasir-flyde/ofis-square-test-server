import nodemailer from 'nodemailer';
import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import dotenv from 'dotenv';
dotenv.config();

// Create transporter using Gmail SMTP from .env
const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
};

/**
 * Get users by role names
 * Supports both formats: "Legal Team" and "legal_team"
 */
export const getUsersByRoles = async (roleNames) => {
  try {
    console.log('🔍 Fetching users by roles:', roleNames);
    
    // Create case-insensitive regex patterns for flexible matching
    const rolePatterns = roleNames.map(name => {
      // Convert snake_case to "Title Case" and vice versa
      const variations = [
        name, // Original
        name.replace(/_/g, ' '), // snake_case to space
        name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '), // Title Case
        name.toLowerCase(),
        name.toUpperCase()
      ];
      return new RegExp(`^(${variations.join('|')})$`, 'i');
    });
    
    const roles = await Role.find({ 
      roleName: { $in: rolePatterns }
    }).select('_id roleName');
    
    console.log('Found roles:', roles.length);
    roles.forEach(r => console.log(`  - ${r.roleName}`));
    
    const roleIds = roles.map(r => r._id);
    
    const users = await User.find({ 
      role: { $in: roleIds },
      email: { $exists: true, $ne: null, $ne: '' }
    }).select('name email');
    
    console.log('Found users with emails:', users.length);
    users.forEach(u => console.log(`  - ${u.name} (${u.email})`));
    
    return users;
  } catch (error) {
    console.error('❌ Error fetching users by roles:', error);
    return [];
  }
};

/**
 * Get contract stakeholders (Sales user + Legal team + System admins)
 */
export const getContractStakeholders = async (contract) => {
  try {
    console.log('👥 Getting contract stakeholders...');
    console.log('Contract created by:', contract.createdBy);
    const stakeholders = [];
    
    // Get sales user who created the contract
    if (contract.createdBy) {
      const salesUser = await User.findById(contract.createdBy).select('name email');
      if (salesUser && salesUser.email) {
        console.log('✓ Found sales user:', salesUser.name, `(${salesUser.email})`);
        stakeholders.push(salesUser);
      } else {
        console.log('⚠️  Sales user not found or has no email');
      }
    }
    
    // Get all Legal Team and System Admin users
    const roleUsers = await getUsersByRoles(['legal_team', 'system_admin']);
    stakeholders.push(...roleUsers);
    
    // Remove duplicates based on email
    const uniqueStakeholders = stakeholders.filter((user, index, self) =>
      index === self.findIndex((u) => u.email === user.email)
    );
    
    console.log('📊 Total unique stakeholders:', uniqueStakeholders.length);
    
    return uniqueStakeholders;
  } catch (error) {
    console.error('❌ Error getting contract stakeholders:', error);
    return [];
  }
};

/**
 * Send email to multiple recipients
 */
const sendEmail = async (recipients, subject, htmlContent, textContent) => {
  try {
    console.log('\n📧 ===== EMAIL SENDING ATTEMPT =====');
    console.log('Subject:', subject);
    console.log('Recipients:', recipients);
    console.log('From:', process.env.SMTP_USER);
    console.log('SMTP Host:', process.env.SMTP_HOST);
    console.log('SMTP Port:', process.env.SMTP_PORT);
    
    if (!recipients || recipients.length === 0) {
      console.log('❌ No recipients to send email to');
      return { success: false, message: 'No recipients' };
    }

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log('❌ SMTP credentials not configured in .env');
      return { success: false, error: 'SMTP credentials missing' };
    }

    const transporter = createTransporter();
    const fromName = process.env.SMTP_FROM_NAME || 'Ofis Square';
    const fromEmail = process.env.SMTP_USER;
    
    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipients.join(', '),
      subject,
      html: htmlContent,
      text: textContent
    };
    
    console.log('🔄 Attempting to send email...');
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully!`);
    console.log('Message ID:', result.messageId);
    console.log('Recipients confirmed:', recipients.join(', '));
    console.log('===================================\n');
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    console.error('Error details:', error);
    console.log('===================================\n');
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Contract Comment/Note Added
 */
export const sendContractCommentEmail = async (contract, comment, addedBy) => {
  try {
    console.log('\n💬 Preparing contract comment email...');
    console.log('Contract ID:', contract._id);
    console.log('Comment by:', addedBy);
    
    const stakeholders = await getContractStakeholders(contract);
    console.log('Found stakeholders:', stakeholders.length);
    const recipients = stakeholders.map(u => u.email);
    
    const subject = `New Comment on Contract #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #FF8C00; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .comment-box { background: white; padding: 15px; border-left: 4px solid #FF8C00; margin: 15px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>💬 New Contract Comment</h2>
          </div>
          <div class="content">
            <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
            <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
            <p><strong>Status:</strong> ${contract.status}</p>
            <p><strong>Added by:</strong> ${addedBy}</p>
            
            <div class="comment-box">
              <p><strong>Comment:</strong></p>
              <p>${comment}</p>
            </div>
            
            <p>View the full contract details in your dashboard.</p>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `New Comment on Contract #${contract._id.toString().slice(-6)}\n\nClient: ${contract.client?.companyName || 'N/A'}\nStatus: ${contract.status}\nAdded by: ${addedBy}\n\nComment: ${comment}`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending contract comment email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Admin Approval Request
 */
export const sendAdminApprovalRequestEmail = async (contract) => {
  try {
    console.log('\n⚠️  Preparing admin approval request email...');
    console.log('Contract ID:', contract._id);
    
    const admins = await getUsersByRoles(['system_admin']);
    console.log('Found system admins:', admins.length);
    const recipients = admins.map(u => u.email);
    
    const subject = `⚠️ Contract Approval Required - #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc3545; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .cta-button { display: inline-block; background: #FF8C00; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>⚠️ Contract Approval Required</h2>
          </div>
          <div class="content">
            <p>A contract is awaiting your approval.</p>
            
            <div class="details">
              <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
              <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
              <p><strong>Building:</strong> ${contract.building?.name || 'N/A'}</p>
              <p><strong>Capacity:</strong> ${contract.capacity} people</p>
              <p><strong>Monthly Rent:</strong> ₹${contract.monthlyRent?.toLocaleString() || '0'}</p>
              <p><strong>Contract Period:</strong> ${new Date(contract.startDate).toLocaleDateString()} - ${new Date(contract.endDate).toLocaleDateString()}</p>
            </div>
            
            <p>Please review and approve this contract at your earliest convenience.</p>
            
            <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts/${contract._id}" class="cta-button">Review Contract</a>
            </div>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `Contract Approval Required\n\nContract ID: #${contract._id.toString().slice(-6)}\nClient: ${contract.client?.companyName || 'N/A'}\nBuilding: ${contract.building?.name || 'N/A'}\nCapacity: ${contract.capacity} people\nMonthly Rent: ₹${contract.monthlyRent?.toLocaleString() || '0'}\n\nPlease review and approve this contract.`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending admin approval request email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Admin Approval Confirmation
 */
export const sendAdminApprovalConfirmationEmail = async (contract) => {
  try {
    console.log('\n✅ Preparing admin approval confirmation email...');
    console.log('Contract ID:', contract._id);
    
    const stakeholders = await getContractStakeholders(contract);
    console.log('Found stakeholders:', stakeholders.length);
    const recipients = stakeholders.map(u => u.email);
    
    const subject = `✅ Contract Approved - #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #28a745; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>✅ Contract Approved</h2>
          </div>
          <div class="content">
            <p>Great news! The contract has been approved by admin.</p>
            
            <div class="details">
              <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
              <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
              <p><strong>Status:</strong> ${contract.status}</p>
              <p><strong>Approved At:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Send contract to client for review</li>
              <li>Await client approval</li>
              <li>Generate stamp paper after client approval</li>
            </ul>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `Contract Approved\n\nContract ID: #${contract._id.toString().slice(-6)}\nClient: ${contract.client?.companyName || 'N/A'}\nStatus: ${contract.status}\n\nNext Steps:\n- Send contract to client for review\n- Await client approval\n- Generate stamp paper after client approval`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending admin approval confirmation email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Client Review Request
 */
export const sendClientReviewRequestEmail = async (contract, clientEmail) => {
  try {
    console.log('\n📄 Preparing client review request email...');
    console.log('Contract ID:', contract._id);
    console.log('Client email:', clientEmail);
    
    const subject = `Contract Ready for Your Review - Ofis Square`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #FF8C00; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .cta-button { display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>📄 Contract Ready for Review</h2>
          </div>
          <div class="content">
            <p>Dear ${contract.client?.companyName || 'Valued Client'},</p>
            
            <p>Your workspace contract is ready for your review and approval.</p>
            
            <div class="details">
              <p><strong>Contract Details:</strong></p>
              <p><strong>Building:</strong> ${contract.building?.name || 'N/A'}</p>
              <p><strong>Capacity:</strong> ${contract.capacity} people</p>
              <p><strong>Monthly Rent:</strong> ₹${contract.monthlyRent?.toLocaleString() || '0'}</p>
              <p><strong>Contract Period:</strong> ${new Date(contract.startDate).toLocaleDateString()} - ${new Date(contract.endDate).toLocaleDateString()}</p>
            </div>
            
            <p><strong>To review and approve your contract:</strong></p>
            <ol>
              <li>Login to your client portal</li>
              <li>Navigate to the Contracts section</li>
              <li>Review the contract details</li>
              <li>Approve or provide feedback</li>
            </ol>
            
            <div style="text-align: center;">
              <a href="https://ofis-square-client.vercel.app/" class="cta-button">Login to Portal</a>
            </div>
            
            <p>If you have any questions or concerns, please don't hesitate to reach out to us.</p>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
            <p>This email was sent to ${clientEmail}</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `Contract Ready for Review\n\nDear ${contract.client?.companyName || 'Valued Client'},\n\nYour workspace contract is ready for your review and approval.\n\nContract Details:\nBuilding: ${contract.building?.name || 'N/A'}\nCapacity: ${contract.capacity} people\nMonthly Rent: ₹${contract.monthlyRent?.toLocaleString() || '0'}\n\nTo review and approve:\n1. Login to https://ofis-square-client.vercel.app/\n2. Navigate to Contracts section\n3. Review and approve\n\nThank you,\nOfis Square Team`;
    
    return await sendEmail([clientEmail], subject, html, text);
  } catch (error) {
    console.error('Error sending client review request email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Client Feedback Alert
 */
export const sendClientFeedbackAlertEmail = async (contract, feedback) => {
  try {
    console.log('\n💬 Preparing client feedback alert email...');
    console.log('Contract ID:', contract._id);
    console.log('Feedback length:', feedback?.length || 0);
    
    const stakeholders = await getContractStakeholders(contract);
    console.log('Found stakeholders:', stakeholders.length);
    const recipients = stakeholders.map(u => u.email);
    
    const subject = `Client Feedback Received - Contract #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #ffc107; color: #333; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .feedback-box { background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 15px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>💬 Client Feedback Received</h2>
          </div>
          <div class="content">
            <p>The client has provided feedback on the contract.</p>
            
            <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
            <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
            
            <div class="feedback-box">
              <p><strong>Client Feedback:</strong></p>
              <p>${feedback}</p>
            </div>
            
            <p><strong>Action Required:</strong></p>
            <ul>
              <li>Review the client's feedback</li>
              <li>Make necessary changes to the contract</li>
              <li>Re-send the contract to the client for approval</li>
            </ul>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `Client Feedback Received\n\nContract ID: #${contract._id.toString().slice(-6)}\nClient: ${contract.client?.companyName || 'N/A'}\n\nClient Feedback:\n${feedback}\n\nAction Required:\n- Review the feedback\n- Make necessary changes\n- Re-send to client`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending client feedback alert email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Legal Review Request (Sales → Legal)
 */
export const sendLegalReviewRequestEmail = async (contract) => {
  try {
    console.log('\n⚖️  Preparing legal review request email...');
    console.log('Contract ID:', contract._id);
    
    const legalTeam = await getUsersByRoles(['legal_team']);
    console.log('Found legal team members:', legalTeam.length);
    const recipients = legalTeam.map(u => u.email);
    
    const subject = `New Contract for Legal Review - #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #6c757d; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .cta-button { display: inline-block; background: #FF8C00; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>⚖️ New Contract for Legal Review</h2>
          </div>
          <div class="content">
            <p>A new contract has been submitted for legal review.</p>
            
            <div class="details">
              <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
              <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
              <p><strong>Building:</strong> ${contract.building?.name || 'N/A'}</p>
              <p><strong>Capacity:</strong> ${contract.capacity} people</p>
              <p><strong>Monthly Rent:</strong> ₹${contract.monthlyRent?.toLocaleString() || '0'}</p>
              <p><strong>Contract Period:</strong> ${new Date(contract.startDate).toLocaleDateString()} - ${new Date(contract.endDate).toLocaleDateString()}</p>
            </div>
            
            <p><strong>Action Required:</strong></p>
            <ul>
              <li>Review contract terms and conditions</li>
              <li>Verify legal compliance</li>
              <li>Check for any potential issues</li>
              <li>Submit to Admin for final approval</li>
            </ul>
            
            <div style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/contracts/${contract._id}" class="cta-button">Review Contract</a>
            </div>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `New Contract for Legal Review\n\nContract ID: #${contract._id.toString().slice(-6)}\nClient: ${contract.client?.companyName || 'N/A'}\nBuilding: ${contract.building?.name || 'N/A'}\nCapacity: ${contract.capacity} people\nMonthly Rent: ₹${contract.monthlyRent?.toLocaleString() || '0'}\n\nAction Required:\n- Review contract terms\n- Verify legal compliance\n- Submit to Admin for approval`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending legal review request email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Contract Sent for Signature
 */
export const sendContractSentForSignatureEmail = async (contract) => {
  try {
    console.log('\n✍️  Preparing contract sent for signature email...');
    console.log('Contract ID:', contract._id);
    
    const stakeholders = await getContractStakeholders(contract);
    console.log('Found stakeholders:', stakeholders.length);
    const recipients = stakeholders.map(u => u.email);
    
    const subject = `✍️ Contract Sent for E-Signature - #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #17a2b8; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>✍️ Contract Sent for E-Signature</h2>
          </div>
          <div class="content">
            <p>The contract has been sent to the client for digital signature via Zoho Sign.</p>
            
            <div class="details">
              <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
              <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
              <p><strong>Building:</strong> ${contract.building?.name || 'N/A'}</p>
              <p><strong>Status:</strong> Awaiting Client Signature</p>
              <p><strong>Sent At:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Client will receive an email from Zoho Sign</li>
              <li>Client will review and sign the document digitally</li>
              <li>You will be notified once the contract is signed</li>
            </ul>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `Contract Sent for E-Signature\n\nContract ID: #${contract._id.toString().slice(-6)}\nClient: ${contract.client?.companyName || 'N/A'}\nBuilding: ${contract.building?.name || 'N/A'}\nStatus: Awaiting Client Signature\n\nThe client will receive an email from Zoho Sign to review and sign the document digitally.`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending contract sent for signature email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Email Template: Contract Signed Confirmation
 */
export const sendContractSignedEmail = async (contract) => {
  try {
    console.log('\n🎉 Preparing contract signed confirmation email...');
    console.log('Contract ID:', contract._id);
    
    const stakeholders = await getContractStakeholders(contract);
    console.log('Found stakeholders:', stakeholders.length);
    const recipients = stakeholders.map(u => u.email);
    
    const subject = `🎉 Contract Signed Successfully - #${contract._id.toString().slice(-6)}`;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #28a745; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
          .details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
          .success-badge { background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; text-align: center; margin: 15px 0; font-weight: bold; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🎉 Contract Signed Successfully!</h2>
          </div>
          <div class="content">
            <div class="success-badge">
              ✅ Contract has been digitally signed by the client
            </div>
            
            <div class="details">
              <p><strong>Contract ID:</strong> #${contract._id.toString().slice(-6)}</p>
              <p><strong>Client:</strong> ${contract.client?.companyName || 'N/A'}</p>
              <p><strong>Building:</strong> ${contract.building?.name || 'N/A'}</p>
              <p><strong>Status:</strong> Signed & Active</p>
              <p><strong>Signed At:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
              <li>Contract is now legally binding and active</li>
              <li>Client onboarding can proceed</li>
              <li>Workspace allocation can be finalized</li>
              <li>Invoicing can be initiated</li>
            </ul>
            
            <p>Congratulations on successfully closing this contract! 🎊</p>
          </div>
          <div class="footer">
            <p>© 2024 Ofis Square. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const text = `Contract Signed Successfully!\n\nContract ID: #${contract._id.toString().slice(-6)}\nClient: ${contract.client?.companyName || 'N/A'}\nBuilding: ${contract.building?.name || 'N/A'}\nStatus: Signed & Active\n\nThe contract has been digitally signed by the client and is now legally binding and active.\n\nNext Steps:\n- Client onboarding can proceed\n- Workspace allocation can be finalized\n- Invoicing can be initiated\n\nCongratulations on successfully closing this contract!`;
    
    return await sendEmail(recipients, subject, html, text);
  } catch (error) {
    console.error('Error sending contract signed email:', error);
    return { success: false, error: error.message };
  }
};

export default {
  sendContractCommentEmail,
  sendAdminApprovalRequestEmail,
  sendAdminApprovalConfirmationEmail,
  sendClientReviewRequestEmail,
  sendClientFeedbackAlertEmail,
  sendLegalReviewRequestEmail,
  sendContractSentForSignatureEmail,
  sendContractSignedEmail,
  getContractStakeholders,
  getUsersByRoles
};
