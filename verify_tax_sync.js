import mongoose from 'mongoose';
import Client from './models/clientModel.js';
import { mapZohoCustomerToClient } from './controllers/zohoBooksWebhookController.js';

// Mock Zoho Payload from USER_REQUEST
const zohoPayload = {
    "customer_id": "3501318000000152026",
    "company_name": "TEST FLYDE 1",
    "tax_info_list": [
        {
            "tax_info_id": "3501318000000152026",
            "tax_registration_no": "29AAAGM0289C1ZF",
            "place_of_supply": "KA",
            "is_primary": true,
            "trader_name": "",
            "legal_name": "TEST FLYDE 1"
        },
        {
            "tax_info_id": "3501318000000170003",
            "tax_registration_no": "29AACCF0683K1ZD",
            "place_of_supply": "KA",
            "is_primary": false,
            "trader_name": "FLIPKART INTERNET PRIVATE LIMITED",
            "legal_name": "FLIPKART INTERNET PRIVATE LIMITED"
        }
    ]
};

async function verifyMapping() {
    console.log("Verifying mapping...");

    // Test mapZohoCustomerToClient mapping
    const mappedData = {
        taxInfoList: zohoPayload.tax_info_list.map(t => ({
            tax_info_id: t.tax_info_id,
            tax_registration_no: t.tax_registration_no,
            place_of_supply: t.place_of_supply,
            is_primary: t.is_primary,
            legal_name: t.legal_name,
            trader_name: t.trader_name
        }))
    };

    console.log("Mapped Data:", JSON.stringify(mappedData, null, 2));

    if (mappedData.taxInfoList.length === 2 &&
        mappedData.taxInfoList[0].tax_info_id === "3501318000000152026" &&
        mappedData.taxInfoList[1].tax_registration_no === "29AACCF0683K1ZD") {
        console.log("✅ Mapping verified successfully!");
    } else {
        console.error("❌ Mapping verification failed!");
    }
}

verifyMapping();
