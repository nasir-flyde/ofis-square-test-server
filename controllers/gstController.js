import axios from "axios";
import { getAccessToken } from "../utils/gstTokenManager.js";

const SANDBOX_BASE_URL = "https://api.sandbox.co.in";

export const validateGST = async (req, res) => {
    try {
        const { gstin } = req.body;

        if (!gstin) {
            return res.status(400).json({ success: false, message: "GSTIN is required" });
        }

        const token = await getAccessToken();

        if (!token) {
            return res.status(500).json({ success: false, message: "Failed to authenticate with GST Service" });
        }

        const apiKey = process.env.SANDBOX_API_KEY || "key_live_62fe648618cb4ddea42383f62e962614";

        const response = await axios.post(
            `${SANDBOX_BASE_URL}/gst/compliance/public/gstin/search`,
            { gstin },
            {
                headers: {
                    Authorization: token,
                    "x-api-key": apiKey,
                    "x-api-version": "1.0.0",
                    "Content-Type": "application/json",
                },
            }
        );

        if (response.data && response.data.data) {
            const apiData = response.data.data;
            return res.status(200).json({
                success: true,
                data: {
                    name: apiData.data.lgnm,
                    place_of_supply: apiData.data.stjCd ? apiData.data.stjCd.substring(0, 2) : "",
                },
            });
        } else {
            return res.status(404).json({
                success: false,
                message: "GSTIN not found or invalid",
                details: response.data,
            });
        }

    } catch (error) {
        console.error("❌ Error validating GSTIN:", error.response?.data || error.message);
        return res.status(error.response?.status || 500).json({
            success: false,
            message: "Error validating GSTIN",
            error: error.response?.data || error.message,
        });
    }
};
