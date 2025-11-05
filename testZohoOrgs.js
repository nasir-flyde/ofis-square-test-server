import dotenv from 'dotenv';
import { getValidAccessToken } from './utils/zohoTokenManager.js';

// Load environment variables
dotenv.config();

async function testZohoOrganizations() {
  console.log('🧪 Testing Zoho Organizations Access...\n');
  
  try {
    // Get access token
    console.log('🔑 Getting access token...');
    const token = await getValidAccessToken();
    console.log('✅ Access token obtained:', token.slice(0, 20) + '...');
    console.log('');
    
    // Test getting list of organizations the token has access to
    console.log('🔍 Getting organizations list...');
    const orgsUrl = `https://www.zohoapis.in/books/v3/organizations`;
    const orgsResponse = await fetch(orgsUrl, {
      method: 'GET',
      headers: { 
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Organizations List Response: ${orgsResponse.status} ${orgsResponse.statusText}`);
    
    if (orgsResponse.ok) {
      const orgsData = await orgsResponse.json();
      console.log('✅ Organizations API working');
      console.log('Available organizations:');
      
      if (orgsData.organizations && orgsData.organizations.length > 0) {
        orgsData.organizations.forEach((org, index) => {
          console.log(`${index + 1}. ${org.name} (ID: ${org.organization_id})`);
          console.log(`   Currency: ${org.currency_code}`);
          console.log(`   Plan: ${org.plan_type || 'Unknown'}`);
          console.log('');
        });
        
        // Check if our configured ORG_ID matches any available organization
        const configuredOrgId = process.env.ZOHO_BOOKS_ORG_ID || "60047183737";
        const matchingOrg = orgsData.organizations.find(org => org.organization_id === configuredOrgId);
        
        if (matchingOrg) {
          console.log(`✅ Configured organization found: ${matchingOrg.name}`);
          
          // Test a simple API call with this organization
          console.log('🔍 Testing API access with configured organization...');
          const testUrl = `https://www.zohoapis.in/books/v3/contacts?organization_id=${configuredOrgId}`;
          const testResponse = await fetch(testUrl, {
            method: 'GET',
            headers: { 
              Authorization: `Zoho-oauthtoken ${token}`,
              'Content-Type': 'application/json'
            }
          });
          
          console.log(`Contacts API Response: ${testResponse.status} ${testResponse.statusText}`);
          
          if (testResponse.ok) {
            const contactsData = await testResponse.json();
            console.log('✅ API access working with configured organization!');
            console.log(`Found ${contactsData.contacts?.length || 0} contacts`);
          } else {
            const errorText = await testResponse.text();
            console.log('❌ API access failed with configured organization:', errorText);
          }
          
        } else {
          console.log(`❌ Configured organization ID (${configuredOrgId}) not found in available organizations`);
          console.log('Please update ZOHO_BOOKS_ORG_ID in your .env file to one of the IDs listed above');
        }
        
      } else {
        console.log('⚠️ No organizations found for this token');
      }
    } else {
      const errorText = await orgsResponse.text();
      console.log('❌ Organizations API failed:', errorText);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testZohoOrganizations();
