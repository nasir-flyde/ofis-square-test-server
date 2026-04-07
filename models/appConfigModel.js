import mongoose from "mongoose";

const appConfigSchema = new mongoose.Schema(
    {
        emailServiceActive: {
            type: Boolean,
            default: true,
        },
        buildingRediectUrl: {
            type: String,
            default: "",
        },
        zoho_sdparentcoa_id_receivable: {
            type: String,
            index: true,
        },
        zoho_sdparentcoa_id_payable: {
            type: String,
            index: true,
        },
    },
    { timestamps: true }
);

const AppConfig = mongoose.model("AppConfig", appConfigSchema);

export default AppConfig;
