import User from '../models/userModel.js';
import Role from '../models/roleModel.js';
import { sendNotification } from './notificationHelper.js';

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
 * Email Template: Contract Comment/Note Added
 */
export const sendContractCommentEmail = async (contract, comment, addedBy) => {
  try {
    const stakeholders = await getContractStakeholders(contract);

    for (const stakeholder of stakeholders) {
      await sendNotification({
        to: { email: stakeholder.email, userId: stakeholder._id },
        channels: { email: true, sms: false },
        templateKey: 'contract_comment_added',
        templateVariables: {
          contractIdShort: contract._id.toString().slice(-6),
          companyName: contract.client?.companyName || 'N/A',
          status: contract.status,
          addedBy: addedBy,
          comment: comment
        },
        title: 'New Contract Comment',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
    const admins = await getUsersByRoles(['system_admin']);

    for (const admin of admins) {
      await sendNotification({
        to: { email: admin.email, userId: admin._id },
        channels: { email: true, sms: false },
        templateKey: 'sales_senior_commercials_approval',
        templateVariables: {
          managerName: admin.name,
          building: contract.building?.name || 'N/A',
          companyName: contract.client?.companyName || 'N/A',
          contractId: contract._id
        },
        title: 'Contract Approval Required',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
    const stakeholders = await getContractStakeholders(contract);

    for (const stakeholder of stakeholders) {
      await sendNotification({
        to: { email: stakeholder.email, userId: stakeholder._id },
        channels: { email: true, sms: false },
        templateKey: 'contract_admin_approved',
        templateVariables: {
          contractIdShort: contract._id.toString().slice(-6),
          companyName: contract.client?.companyName || 'N/A',
          status: contract.status,
          approvedAt: new Date().toLocaleString()
        },
        title: 'Contract Approved',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
    await sendNotification({
      to: { email: clientEmail, clientId: contract.client?._id },
      channels: { email: true, sms: false },
      templateKey: 'contract_client_review_request',
      templateVariables: {
        companyName: contract.client?.companyName || 'Valued Client',
        building: contract.building?.name || 'N/A',
        peopleCount: contract.capacity,
        monthlyRent: contract.monthlyRent?.toLocaleString() || '0',
        startDate: new Date(contract.startDate).toLocaleDateString(),
        endDate: new Date(contract.endDate).toLocaleDateString(),
        portalLink: 'https://ofis-square-client.vercel.app/'
      },
      title: 'Contract Ready for Review',
      source: 'contract_system',
      type: 'transactional'
    });
    return { success: true };
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
    const stakeholders = await getContractStakeholders(contract);

    for (const stakeholder of stakeholders) {
      await sendNotification({
        to: stakeholder.email ? { email: stakeholder.email, userId: stakeholder._id } : stakeholder,
        channels: { email: true, sms: false },
        templateKey: 'contract_client_feedback_alert',
        templateVariables: {
          contractIdShort: contract._id.toString().slice(-6),
          companyName: contract.client?.companyName || 'N/A',
          feedback: feedback
        },
        title: 'Client Contract Feedback',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
    const legalTeam = await getUsersByRoles(['legal_team']);

    for (const member of legalTeam) {
      await sendNotification({
        to: { email: member.email, userId: member._id },
        channels: { email: true, sms: false },
        templateKey: 'legal_team_contract_upload',
        templateVariables: {
          companyName: contract.client?.companyName || 'N/A',
          contractId: contract._id
        },
        title: 'Legal Review Required',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
    const stakeholders = await getContractStakeholders(contract);

    for (const stakeholder of stakeholders) {
      await sendNotification({
        to: { email: stakeholder.email, userId: stakeholder._id },
        channels: { email: true, sms: false },
        templateKey: 'contract_sent_for_signature',
        templateVariables: {
          contractIdShort: contract._id.toString().slice(-6),
          companyName: contract.client?.companyName || 'N/A',
          building: contract.building?.name || 'N/A',
          sentAt: new Date().toLocaleString()
        },
        title: 'Contract Sent for Signature',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
    const stakeholders = await getContractStakeholders(contract);

    for (const stakeholder of stakeholders) {
      await sendNotification({
        to: { email: stakeholder.email, userId: stakeholder._id },
        channels: { email: true, sms: false },
        templateKey: 'contract_signed_confirmation',
        templateVariables: {
          contractIdShort: contract._id.toString().slice(-6),
          companyName: contract.client?.companyName || 'N/A',
          building: contract.building?.name || 'N/A',
          signedAt: new Date().toLocaleString()
        },
        title: 'Contract Signed Successfully',
        source: 'system',
        type: 'transactional'
      });
    }
    return { success: true };
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
