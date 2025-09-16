import { initializeWithToken } from "./zohoTokenManager.js";

async function migrateExistingToken() {
  const existingToken = "1000.7ef93abb1bf455fff889ab88f31fe59d.c9ea42fb1cd3b58f6b10c98c595d7349";
  
  try {
    await initializeWithToken(existingToken, 3600);
    console.log("✅ Successfully migrated existing token to token manager");
    console.log("🔧 Next steps:");
    console.log("1. Set up your .env file with ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN");
    console.log("2. The system will automatically refresh tokens when they expire");
    console.log("3. You can delete this migration script after running it once");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateExistingToken();
}

export { migrateExistingToken };
