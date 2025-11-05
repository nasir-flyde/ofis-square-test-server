import dotenv from 'dotenv';
import { getValidAccessToken } from './utils/zohoTokenManager.js';
import { createZohoInvoiceFromLocal } from './utils/zohoBooks.js';

// Load environment variables
dotenv.config();

async function testZohoInvoicePush() {
  console.log('🧪 Testing Zoho Invoice Push...\n');
  
  try {
    // First, verify we can get a valid access token
    console.log('🔑 Getting access token...');
    const token = await getValidAccessToken();
    console.log('✅ Access token obtained:', token.slice(0, 20) + '...');
    console.log('');
    
    // Create a sample invoice data
    const sampleInvoice = {
      invoiceNumber: 'TEST-INV-001',
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      items: [
        {
          description: 'Test Service',
          quantity: 1,
          unitPrice: 1000,
          amount: 1000
        }
      ],
      subtotal: 1000,
      total: 1000,
      notes: 'Test invoice for API integration',
      billingPeriod: {
        start: new Date().toISOString(),
        end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    };
    
    // Create a sample client data
    const sampleClient = {
      companyName: 'Test Company Ltd',
      contactPerson: 'John Doe',
      email: 'test@testcompany.com',
      phone: '+91-9876543210',
      contactType: 'customer',
      customerSubType: 'business',
      billingAddress: {
        attention: 'John Doe',
        address: '123 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip: '400001',
        country: 'INDIA',
        phone: '+91-9876543210'
      }
    };
    
    console.log('📄 Creating test invoice in Zoho Books...');
    console.log('Invoice Number:', sampleInvoice.invoiceNumber);
    console.log('Client:', sampleClient.companyName);
    console.log('Amount:', sampleInvoice.total);
    console.log('');
    
    // Push the invoice to Zoho
    const zohoInvoice = await createZohoInvoiceFromLocal(sampleInvoice, sampleClient);
    
    if (zohoInvoice && zohoInvoice.invoice) {
      console.log('✅ Invoice successfully created in Zoho Books!');
      console.log('Zoho Invoice ID:', zohoInvoice.invoice.invoice_id);
      console.log('Zoho Invoice Number:', zohoInvoice.invoice.invoice_number);
      console.log('Status:', zohoInvoice.invoice.status);
      console.log('Total:', zohoInvoice.invoice.total);
      console.log('Customer ID:', zohoInvoice.invoice.customer_id);
      
      if (zohoInvoice.invoice.invoice_url) {
        console.log('Invoice URL:', zohoInvoice.invoice.invoice_url);
      }
    } else {
      console.log('❌ Failed to create invoice in Zoho Books');
      console.log('Response:', JSON.stringify(zohoInvoice, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testZohoInvoicePush();
