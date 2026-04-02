import axios from "axios";

export const validateGST = async (req, res) => {
    try {
        const gstin = req.body?.gstin || req.query?.gstin;

        if (!gstin) {
            return res.status(400).json({ success: false, message: "GSTIN is required" });
        }

        const token = process.env.SUREPASS_BEARER_TOKEN;

        const url = process.env.SUREPASS_URL;

        const response = await axios.post(
            url,
            { id_number: gstin },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (response.data && response.data.data) {
            const apiData = response.data.data;
            const stateCodeMap = {
                "35": "AN", "28": "AP", "12": "AR", "18": "AS", "10": "BR", "04": "CH", "22": "CT",
                "26": "DN", "25": "DN", "07": "DL", "30": "GA", "24": "GJ", "06": "HR", "02": "HP",
                "01": "JK", "20": "JH", "29": "KA", "32": "KL", "37": "LA", "31": "LD", "23": "MP",
                "27": "MH", "14": "MN", "17": "ML", "15": "MZ", "13": "NL", "21": "OR", "34": "PY",
                "03": "PB", "08": "RJ", "11": "SK", "33": "TN", "36": "TS", "16": "TR", "09": "UP",
                "05": "UK", "19": "WB"
            };
            const stateCode = gstin.substring(0, 2);

            return res.status(200).json({
                success: true,
                data: {
                    name: apiData.legal_name,
                    tradeNam: apiData.business_name,
                    place_of_supply: stateCodeMap[stateCode] || stateCode,
                    pradr: {
                        addr: {
                            st: apiData.address
                        }
                    }
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

        const errorData = error.response?.data;
        let errorMessage = "Error validating GSTIN";

        if (errorData && errorData.message_code === "balance_exhausted") {
            errorMessage = "Third-party service credit issue: API Balance Exhausted. Please recharge Surepass.";
        }

        let statusCode = error.response?.status || 500;
        if (statusCode === 401) statusCode = 400; // Map 401 to 400 to prevent frontend redirect

        return res.status(statusCode).json({
            success: false,
            message: errorMessage,
            error: errorData || error.message,
        });
    }
};
