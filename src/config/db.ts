import mongoose from 'mongoose';

export async function connectToDatabase() {
    try{
        console.log(process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log('Connected to the database');
    }
    catch (error) {
        console.error('Error connecting to the database:', error);
        throw error;
    }
}
