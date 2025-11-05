import apiLogger from './apiLogger.js';
import { getAccessToken } from '../utils/zohoSignAuth.js';
import FormData from 'form-data';
import fetch from 'node-fetch';

/**
 * Logged wrapper for Zoho Sign API calls
 */
class LoggedZohoSign {
  constructor() {
    this.service = 'zoho_sign';
    this.baseUrl = this._getZohoSignBaseUrl();
  }

  /**
   * Create document in Zoho Sign with logging
   */
  async createDocument(contract, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'create_document',
      userId,
      clientId: clientId || contract.client,
      relatedEntity: 'contract',
      relatedEntityId: contract._id,
      maxAttempts: 2,
      retryCondition: (response, responseBody) => {
        if (response?.status >= 500) return true;
        if (response?.status === 429) return true;
        return false;
      }
    });

    try {
      const formData = new FormData();
      
      // Prepare file buffer
      let fileBuffer = null;
      let fileName = `contract_${contract._id || 'doc'}.pdf`;
      
      console.log('Contract fileUrl:', contract.fileUrl);
      console.log('Contract ID:', contract._id);
      console.log('Contract client:', contract.client?.companyName);
      
      if (contract.fileUrl) {
        console.log('Downloading file from URL:', contract.fileUrl);
        const fileResp = await fetch(contract.fileUrl);
        if (!fileResp.ok) {
          throw new Error(`Failed to download fileUrl: HTTP ${fileResp.status} - ${fileResp.statusText}`);
        }
        fileBuffer = Buffer.from(await fileResp.arrayBuffer());
        console.log('File buffer size:', fileBuffer.length, 'bytes');
        const urlName = (contract.fileUrl.split('?')[0] || '').split('/').pop();
        if (urlName) fileName = urlName;

        // Ensure filename has .pdf extension
        if (!/\.pdf$/i.test(fileName)) {
          fileName = `${fileName}.pdf`;
        }

        // Basic PDF validation: check magic bytes
        const isPdf = fileBuffer && fileBuffer.length > 4 && fileBuffer.slice(0, 4).toString() === '%PDF';
        console.log('PDF validation - First 20 bytes:', fileBuffer.slice(0, 20).toString());
        console.log('PDF validation - Last 20 bytes:', fileBuffer.slice(-20).toString());
        console.log('Is valid PDF:', isPdf);
        
        if (!isPdf) {
          console.warn('The downloaded file does not appear to be a PDF. Zoho Sign requires a valid PDF.');
          console.log('File content preview:', fileBuffer.slice(0, 200).toString());
          throw new Error('Downloaded file is not a valid PDF');
        }
        
        // Check if file is too small (might be an error page)
        if (fileBuffer.length < 1000) {
          console.warn('PDF file seems unusually small:', fileBuffer.length, 'bytes');
          console.log('Small file content:', fileBuffer.toString());
        }
      } else {
        // Would need to import generateContractPDFBuffer here
        throw new Error('No file URL provided for contract - contract must have a fileUrl to send for signature');
      }

      // Try a different approach - use the exact format Zoho Sign expects
      formData.append('file', fileBuffer, {
        filename: fileName,
        contentType: 'application/pdf'
      });
      
      // Use the exact JSON structure Zoho Sign expects
      const requestData = {
        requests: {
          request_name: `Contract for ${contract.client.companyName || 'Contract'}`,
          expiration_days: 30,
          is_sequential: true,
          email_reminders: true,
          reminder_period: 5
        }
      };
      
      console.log('Request data being sent:', JSON.stringify(requestData, null, 2));
      formData.append('data', JSON.stringify(requestData));

      const accessToken = await getAccessToken();
      console.log('Access token length:', accessToken ? accessToken.length : 'null');
      console.log('Zoho Sign base URL:', this.baseUrl);
      console.log('Form data keys:', Object.keys(formData));
      
      // Perform fetch with explicit API logging so it appears in API Call Logs
      const url = `${this.baseUrl}/requests`;
      const headers = {
        ...(typeof formData.getHeaders === 'function' ? formData.getHeaders() : {}),
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      };

      // Start API log
      const requestId = await apiLogger.logOutgoingCall({
        service: this.service,
        operation: 'create_document',
        method: 'POST',
        url,
        headers,
        requestBody: { multipart: true, parts: ['file', 'data'] },
        userId,
        clientId: clientId || contract.client,
        relatedEntity: 'contract',
        relatedEntityId: contract._id,
        attemptNumber: 1,
        maxAttempts: 1
      });

      let response;
      let result;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: formData
        });

        const responseText = await response.text();
        try {
          result = responseText ? JSON.parse(responseText) : null;
        } catch (_) {
          result = responseText;
        }

        await apiLogger.logResponse({
          requestId,
          statusCode: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: result,
          success: response.ok,
          errorMessage: response.ok ? null : (result?.message || `HTTP ${response.status}`)
        });

        console.log('Zoho Sign API response:', JSON.stringify(result, null, 2));
        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      } catch (err) {
        await apiLogger.logResponse({
          requestId,
          statusCode: 0,
          responseHeaders: {},
          responseBody: null,
          success: false,
          errorMessage: err.message
        });
        throw err;
      }
      
      if (result?.status !== "success") {
        const msg = result.message || "Zoho Sign API error";
        console.error('Zoho Sign API error details:', {
          status: result.status,
          message: result.message,
          code: result.code,
          errors: result.errors,
          fullResponse: result
        });
        throw new Error(`Zoho Sign API error: ${msg}`);
      }

      return result.requests?.request_id;
    } catch (error) {
      console.error('Zoho Sign create document error:', error);
      throw error;
    }
  }

  /**
   * Add recipient to document with logging
   */
  async addRecipient(requestId, client, documentId, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'add_recipient',
      userId,
      clientId: clientId || client._id,
      relatedEntity: 'contract',
      maxAttempts: 3,
      retryCondition: (response, responseBody) => {
        if (response?.status >= 500) return true;
        if (response?.status === 429) return true;
        // Retry if document not yet available
        const msg = responseBody?.message || '';
        if (typeof msg === 'string' && msg.toLowerCase().includes('document does not exist')) {
          return true;
        }
        return false;
      }
    });

    const actionData = {
      requests: {
        actions: [{
          action_type: "SIGN",
          recipient_name: client.contactPerson,
          recipient_email: client.email,
          signing_order: 1,
          fields: [{
            field_type_name: "Signature",
            document_id: documentId,
            page_no: 1,
            x_coord: 100,
            y_coord: 200,
            width: 150,
            height: 50,
            is_mandatory: true
          }]
        }]
      }
    };

    try {
      const accessToken = await getAccessToken();
      const response = await loggedFetch(`${this.baseUrl}/requests/${requestId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(actionData)
      });

      const result = await response.json();
      if (result.status !== "success") {
        const msg = result.message || "Failed to add recipient";
        throw new Error(`Failed to add recipient: ${msg}`);
      }

      return result;
    } catch (error) {
      console.error('Zoho Sign add recipient error:', error);
      throw error;
    }
  }

  /**
   * Submit document for signature with logging
   */
  async submitDocument(requestId, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'submit_document',
      userId,
      clientId,
      relatedEntity: 'contract',
      maxAttempts: 2
    });

    try {
      const accessToken = await getAccessToken();
      const response = await loggedFetch(`${this.baseUrl}/requests/${requestId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests: {} })
      });

      const result = await response.json();
      if (result.status !== "success") {
        const msg = result.message || "Failed to submit document";
        throw new Error(`Failed to submit document: ${msg}`);
      }

      return result;
    } catch (error) {
      console.error('Zoho Sign submit document error:', error);
      throw error;
    }
  }

  /**
   * Get document status with logging
   */
  async getDocumentStatus(requestId, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'get_document_status',
      userId,
      clientId,
      relatedEntity: 'contract',
      maxAttempts: 2
    });

    try {
      const accessToken = await getAccessToken();
      const response = await loggedFetch(`${this.baseUrl}/requests/${requestId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      });

      const result = await response.json();
      if (result.status !== "success") {
        const msg = result.message || "Failed to get document status";
        throw new Error(`Failed to get document status: ${msg}`);
      }

      return result.requests;
    } catch (error) {
      console.error('Zoho Sign get document status error:', error);
      throw error;
    }
  }

  /**
   * Download signed document with logging
   */
  async downloadSignedDocument(requestId, { userId = null, clientId = null } = {}) {
    const loggedFetch = apiLogger.createLoggedFetch({
      service: this.service,
      operation: 'download_signed_document',
      userId,
      clientId,
      relatedEntity: 'contract',
      maxAttempts: 2
    });

    try {
      const accessToken = await getAccessToken();
      const response = await loggedFetch(`${this.baseUrl}/requests/${requestId}/pdf`, {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download signed document: HTTP ${response.status}`);
      }

      const pdfBuffer = Buffer.from(await response.arrayBuffer());
      return pdfBuffer;
    } catch (error) {
      console.error('Zoho Sign download document error:', error);
      throw error;
    }
  }

  /**
   * Verify document exists with logging
   */
  async verifyDocumentExists(requestId, { userId = null, clientId = null } = {}) {
    const maxRetries = 5;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.getDocumentStatus(requestId, { userId, clientId });
        
        // Check for OAuth scope issues
        if (result?.code === 9040) {
          const guidance = "Zoho Sign returned 'Invalid Oauth Scope'. Ensure your refresh token has Zoho Sign scopes.";
          throw new Error(guidance);
        }
        
        if (result) {
          console.log(`Document ${requestId} verified on attempt ${attempt}`);
          return result;
        }
        
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    throw new Error(`Document ${requestId} not available after ${maxRetries} attempts`);
  }

  // Private helper methods
  _getZohoSignBaseUrl() {
    const signDc = process.env.ZOHO_SIGN_DC;
    if (signDc) return `https://${signDc}/api/v1`;
    
    const accountsDc = process.env.ZOHO_DC || "accounts.zoho.in";
    if (accountsDc.endsWith("zoho.in")) return "https://sign.zoho.in/api/v1";
    if (accountsDc.endsWith("zoho.eu")) return "https://sign.zoho.eu/api/v1";
    if (accountsDc.endsWith("zoho.com.cn")) return "https://sign.zoho.com.cn/api/v1";
    
    return "https://sign.zoho.in/api/v1";
  }
}

// Create singleton instance
const loggedZohoSign = new LoggedZohoSign();

export default loggedZohoSign;
