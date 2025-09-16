import { getValidAccessToken, getTokenInfo } from "./zohoTokenManager.js";

/**
 * Test script to debug Zoho token issues
 */
async function testZohoToken() {
  console.log("🧪 Testing Zoho Token System...\n");
  
  try {
    // Check current token info
    console.log("📊 Current token info:");
    const tokenInfo = getTokenInfo();
    console.log(JSON.stringify(tokenInfo, null, 2));
    console.log("");
    
    // Try to get a valid access token
    console.log("🔑 Attempting to get valid access token...");
    const token = await getValidAccessToken();
    
    if (token) {
      console.log("✅ Successfully obtained access token:");
      console.log(`Token: ${token.slice(0, 20)}...`);
      
      // Test a simple API call
      console.log("\n🌐 Testing API call with token...");
      const testResponse = await fetch("https://books.zohoapis.in/api/v3/contacts?organization_id=60047183737", {
        method: "GET",
        headers: { 
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json"
        }
      });
      
      console.log(`API Response Status: ${testResponse.status} ${testResponse.statusText}`);
      
      if (testResponse.ok) {
        console.log("✅ API call successful!");
      } else {
        const errorText = await testResponse.text();
        console.log("❌ API call failed:");
        console.log(errorText);
      }
      
    } else {
      console.log("❌ Failed to obtain access token");
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("Full error:", error);
  }
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testZohoToken();
}

export { testZohoToken };
