import dotenv from 'dotenv';
import { getValidAccessToken, getTokenInfo } from './utils/zohoTokenManager.js';

// Load environment variables
dotenv.config();

async function testZohoToken() {
  console.log('🧪 Testing Zoho Token System...\n');
  
  // Check environment variables
  console.log('Environment Variables:');
  console.log('ZOHO_BOOKS_CLIENT_ID:', process.env.ZOHO_BOOKS_CLIENT_ID ? 'SET' : 'NOT SET');
  console.log('ZOHO_BOOKS_CLIENT_SECRET:', process.env.ZOHO_BOOKS_CLIENT_SECRET ? 'SET' : 'NOT SET');
  console.log('ZOHO_BOOKS_REFRESH_TOKEN:', process.env.ZOHO_BOOKS_REFRESH_TOKEN ? 'SET' : 'NOT SET');
  console.log('');
  
  try {
    // Check current token info
    console.log('📊 Current token info:');
    const tokenInfo = getTokenInfo();
    console.log(JSON.stringify(tokenInfo, null, 2));
    console.log('');
    
    // Try to get a valid access token
    console.log('🔑 Attempting to get valid access token...');
    const token = await getValidAccessToken();
    
    if (token) {
      console.log('✅ Successfully obtained access token:');
      console.log(`Token: ${token.slice(0, 20)}...`);
      console.log('');
      
      // Test API call
      console.log('🌐 Testing API call with token...');
      const response = await fetch(`https://books.zohoapis.com/api/v3/contacts?organization_id=${process.env.ZOHO_BOOKS_ORG_ID || '60047183737'}`, {
        method: 'GET',
        headers: { 
          Authorization: `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`API Response Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ API call successful!');
        console.log(`Found ${data.contacts?.length || 0} contacts`);
      } else {
        const errorText = await response.text();
        console.log('❌ API call failed:');
        console.log(errorText);
      }
      
    } else {
      console.log('❌ Failed to obtain access token');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testZohoToken();
