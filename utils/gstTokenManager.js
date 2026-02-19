import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_FILE_PATH = path.resolve(__dirname, "../gst-tokens.json");

const SANDBOX_BASE_URL = "https://api.sandbox.co.in";

export const getAccessToken = async () => {
    let tokenData = loadToken();

    if (tokenData && isValid(tokenData)) {
        return tokenData.access_token;
    }

    return await refreshAccessToken();
};
//ok
export const refreshAccessToken = async () => {
    try {
        const apiKey = process.env.SANDBOX_API_KEY || "key_live_62fe648618cb4ddea42383f62e962614";
        const apiSecret = process.env.SANDBOX_API_SECRET || "secret_live_361b196268534b7a90764508f37629e0";

        if (!apiKey || !apiSecret) {
            console.error("❌ Sandbox API Key or Secret is missing in .env");
            return null;
        }

        const response = await axios.post(
            `${SANDBOX_BASE_URL}/authenticate`,
            {},
            {
                headers: {
                    "x-api-key": apiKey,
                    "x-api-secret": apiSecret,
                    "x-api-version": "1.0.0",
                },
            }
        );

        if (response.data && response.data.access_token) {
            const tokenData = {
                access_token: response.data.access_token,
                expires_at: Date.now() + 23 * 60 * 60 * 1000, // Token valid for ~24 hours, refresh slightly earlier
            };

            saveToken(tokenData);
            console.log("✅ GST Token refreshed successfully");
            return tokenData.access_token;
        } else {
            console.error("❌ Failed to refresh GST Token: No access_token in response", response.data);
            return null;
        }
    } catch (error) {
        console.error("❌ Error refreshing GST Token:", error.response?.data || error.message);
        return null;
    }
};

const saveToken = (tokenData) => {
    try {
        fs.writeFileSync(TOKEN_FILE_PATH, JSON.stringify(tokenData, null, 2));
    } catch (err) {
        console.error("❌ Error saving GST token to file:", err);
    }
};

const loadToken = () => {
    try {
        if (fs.existsSync(TOKEN_FILE_PATH)) {
            const data = fs.readFileSync(TOKEN_FILE_PATH, "utf8");
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("❌ Error loading GST token from file:", err);
    }
    return null;
};

const isValid = (tokenData) => {
    return tokenData && tokenData.expires_at && tokenData.expires_at > Date.now();
};
