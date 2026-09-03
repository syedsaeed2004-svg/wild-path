/**
 * WILDPATH EXPLORER - MONGODB DATABASE ENGINE
 * Integrates Mongoose ORM for Users, Expeditions & SOS Alerts.
 * Includes automatic graceful fallback to JSON file storage if MongoDB service is offline!
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://syedsaeed2004_db_user:syedSAHMED@m0cluster.zp8yldo.mongodb.net/wildpath_explorer?retryWrites=true&w=majority';

let isMongoConnected = false;

async function connectDB() {
    try {
        mongoose.set('strictQuery', false);
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 3000 // Fast timeout if Mongo is not running locally
        });
        isMongoConnected = true;
        console.log('====================================================');
        console.log(' MONGODB DATABASE CONNECTED SUCCESSFULLY!');
        console.log(` URI: ${MONGODB_URI}`);
        console.log('====================================================');
    } catch (err) {
        isMongoConnected = false;
        console.log('----------------------------------------------------');
        console.log(' MONGODB NOT DETECTED LOCALLY - RUNNING IN FILE-BASED HYBRID MODE.');
        console.log(' All operations will persist to local JSON storage smoothly.');
        console.log('----------------------------------------------------');
    }
}

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, default: 'explorer' },
    createdAt: { type: Date, default: Date.now }
});

// Expedition Trail Schema
const expeditionSchema = new mongoose.Schema({
    userId: { type: String, default: 'guest' },
    name: { type: String, required: true },
    points: { type: Array, required: true },
    waypoints: { type: Array, default: [] },
    totalDistance: { type: Number, default: 0 },
    totalSteps: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    tags: [String],
    notes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// SOS Alert Schema
const sosSchema = new mongoose.Schema({
    userId: { type: String, default: 'guest' },
    position: { x: Number, y: Number },
    heading: { type: Number, default: 0 },
    displacement: { type: Number, default: 0 },
    bearingToBase: { type: String, default: '180°' },
    status: { type: String, default: 'ACTIVE_ALERT' },
    notes: { type: String, default: 'EMERGENCY DISTRESS BEACON' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Expedition = mongoose.model('Expedition', expeditionSchema);
const SosAlert = mongoose.model('SosAlert', sosSchema);

module.exports = {
    connectDB,
    isMongoConnected: () => isMongoConnected,
    User,
    Expedition,
    SosAlert
};
