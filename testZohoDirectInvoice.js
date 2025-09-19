import dotenv from 'dotenv';
import { getValidAccessToken } from './utils/zohoTokenManager.js';

// Load environment variables
dotenv.config();

async function testDirectZohoInvoice() {
  console.log('🧪 Testing Direct Zoho Invoice Creation...\n');
  
  try {
    // Get access token
    console.log('🔑 Getting access token...');
    const token = await getValidAccessToken();
    console.log('✅ Access token obtained:', token.slice(0, 20) + '...');
    console.log('');
    
    const ORG_ID = process.env.ZOHO_BOOKS_ORG_ID || "60047183737";
    const BASE_URL = "https://www.zohoapis.in/books/v3";
    
    // First, let's test a simple API call to check permissions
    console.log('🔍 Testing basic API access...');
    const testUrl = `${BASE_URL}/organizations?organization_id=${ORG_ID}`;
    const testResponse = await fetch(testUrl, {
      method: 'GET',
      headers: { 
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Organizations API Response: ${testResponse.status} ${testResponse.statusText}`);
    
    if (testResponse.ok) {
      const orgData = await testResponse.json();
      console.log('✅ Basic API access working');
      console.log('Organization:', orgData.organization?.name || 'Unknown');
    } else {
      const errorText = await testResponse.text();
      console.log('❌ Basic API access failed:', errorText);
      return;
    }
    console.log('');
    
    // Test getting contacts to see what's available
    console.log('🔍 Testing contacts API...');
    const contactsUrl = `${BASE_URL}/contacts?organization_id=${ORG_ID}`;
    const contactsResponse = await fetch(contactsUrl, {
      method: 'GET',
      headers: { 
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Contacts API Response: ${contactsResponse.status} ${contactsResponse.statusText}`);
    
    if (contactsResponse.ok) {
      const contactsData = await contactsResponse.json();
      console.log('✅ Contacts API working');
      console.log(`Found ${contactsData.contacts?.length || 0} contacts`);
      
      if (contactsData.contacts && contactsData.contacts.length > 0) {
        const firstContact = contactsData.contacts[0];
        console.log(`Using existing contact: ${firstContact.contact_name} (ID: ${firstContact.contact_id})`);
        
        // Now try to create an invoice with this existing contact
        console.log('');
        console.log('📄 Creating invoice with existing contact...');
        
        const invoicePayload = {
          customer_id: firstContact.contact_id,
          date: new Date().toISOString().slice(0, 10),
          due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          line_items: [
            {
              item_id: "2865532000000048245", // Default item ID
              rate: 1000,
              quantity: 1
            }
          ],
          notes: "Test invoice created via API",
          terms: "Payment due within 30 days"
        };
        
        const invoiceUrl = `${BASE_URL}/invoices?organization_id=${ORG_ID}`;
        const invoiceResponse = await fetch(invoiceUrl, {
          method: 'POST',
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(invoicePayload)
        });
        
        console.log(`Invoice API Response: ${invoiceResponse.status} ${invoiceResponse.statusText}`);
        
        if (invoiceResponse.ok) {
          const invoiceData = await invoiceResponse.json();
          console.log('✅ Invoice created successfully!');
          console.log('Invoice ID:', invoiceData.invoice?.invoice_id);
          console.log('Invoice Number:', invoiceData.invoice?.invoice_number);
          console.log('Status:', invoiceData.invoice?.status);
          console.log('Total:', invoiceData.invoice?.total);
        } else {
          const errorText = await invoiceResponse.text();
          console.log('❌ Invoice creation failed:', errorText);
        }
      } else {
        console.log('⚠️ No existing contacts found. You may need to create a contact first.');
      }
    } else {
      const errorText = await contactsResponse.text();
      console.log('❌ Contacts API failed:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testDirectZohoInvoice();
