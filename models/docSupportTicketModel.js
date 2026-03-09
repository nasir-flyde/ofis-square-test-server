import mongoose from "mongoose";

const docSupportTicketSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        subject: {
            type: String,
            required: true,
            trim: true,
        },
        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "DocSupportCategory",
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        image: {
            type: String, // Store imagekit image URL
        },
        status: {
            type: String,
            enum: ["open", "closed"],
            default: "open",
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "DocSupportUser",
            required: true,
        },
    },
    {
        timestamps: true,
        collection: "doc_support_tickets",
    }
);

export default mongoose.model("DocSupportTicket", docSupportTicketSchema);
