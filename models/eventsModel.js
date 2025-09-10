import mongoose from "mongoose"

const eventsSchema = new mongoose.Schema(
    {
        title : {
            type : String,
            required : true
        },
        description : {
            type : String,
            required : true
        },
        startDate : {
            type : Date
        },
        endDate : {
            type : Date
        },
        createdBy : {
            
        }
    }
)