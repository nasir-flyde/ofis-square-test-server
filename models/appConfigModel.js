import mongoose from "mongoose";

const appConfigSchema = new mongoose.Schema(
    {
        emailServiceActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

const AppConfig = mongoose.model("AppConfig", appConfigSchema);

export default AppConfig;
