/**
 * WILDPATH EXPLORER - BACKEND SERVER (Node.js + Express + MongoDB)
 * Authentication, Expedition Persistence, GPX/KML Exporters, SOS Logger & Dashboard.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 8086;
const JWT_SECRET = process.env.JWT_SECRET || 'wildpath_secret_jwt_key_2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Connect Database
db.connectDB();

// File Storage Paths (Fallback)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const TRAILS_FILE = path.join(DATA_DIR, 'expeditions.json');
const SOS_FILE = path.join(DATA_DIR, 'sos_alerts.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function readJSON(file, defaultData = []) {
    try {
        if (!fs.existsSync(file)) return defaultData;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return defaultData;
    }
}

function writeJSON(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) req.user = null;
        else req.user = user;
        next();
    });
}

app.use(authenticateToken);

// ==========================================================================
// AUTHENTICATION API ENDPOINTS
// ==========================================================================

// Register New Explorer
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ success: false, error: 'Username, email, and password are required.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        if (db.isMongoConnected()) {
            const existingUser = await db.User.findOne({ $or: [{ email }, { username }] });
            if (existingUser) {
                return res.status(400).json({ success: false, error: 'Username or email already exists.' });
            }

            const newUser = await db.User.create({
                username,
                email,
                password: hashedPassword
            });

            const token = jwt.sign({ id: newUser._id, username: newUser.username, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

            return res.status(201).json({
                success: true,
                token,
                user: { id: newUser._id, username: newUser.username, email: newUser.email }
            });
        }

        // File-based Fallback
        const users = readJSON(USERS_FILE, []);
        if (users.find(u => u.email === email || u.username === username)) {
            return res.status(400).json({ success: false, error: 'Username or email already exists.' });
        }

        const newUser = {
            id: 'usr_' + Date.now(),
            username,
            email,
            password: hashedPassword,
            createdAt: new Date()
        };

        users.push(newUser);
        writeJSON(USERS_FILE, users);

        const token = jwt.sign({ id: newUser.id, username: newUser.username, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

        return res.status(201).json({
            success: true,
            token,
            user: { id: newUser.id, username: newUser.username, email: newUser.email }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Login Explorer
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required.' });
        }

        if (db.isMongoConnected()) {
            const user = await db.User.findOne({ email });
            if (!user) {
                return res.status(400).json({ success: false, error: 'Invalid email or password.' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ success: false, error: 'Invalid email or password.' });
            }

            const token = jwt.sign({ id: user._id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

            return res.json({
                success: true,
                token,
                user: { id: user._id, username: user.username, email: user.email }
            });
        }

        // File-based Fallback
        const users = readJSON(USERS_FILE, []);
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(400).json({ success: false, error: 'Invalid email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, error: 'Invalid email or password.' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        return res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, email: user.email }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get Current Profile
app.get('/api/auth/me', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Not authenticated.' });
    }
    res.json({ success: true, user: req.user });
});

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
    let totalTrails = 0;
    let totalSosAlerts = 0;

    if (db.isMongoConnected()) {
        totalTrails = await db.Expedition.countDocuments();
        totalSosAlerts = await db.SosAlert.countDocuments();
    } else {
        totalTrails = readJSON(TRAILS_FILE).length;
        totalSosAlerts = readJSON(SOS_FILE).length;
    }

    res.json({
        status: 'ONLINE',
        system: 'WildPath Explorer Dead-Reckoning Backend',
        database: db.isMongoConnected() ? 'MongoDB Connected' : 'File Storage Fallback',
        uptime: process.uptime(),
        totalTrails,
        totalSosAlerts,
        timestamp: new Date()
    });
});

// ==========================================================================
// TRAILS API (MONGODB & FILE STORAGE HYBRID)
// ==========================================================================

// Get All Saved Trails
app.get('/api/trails', async (req, res) => {
    try {
        if (db.isMongoConnected()) {
            const query = req.user ? { $or: [{ userId: req.user.id }, { userId: 'guest' }] } : {};
            const trails = await db.Expedition.find(query).sort({ createdAt: -1 });
            return res.json({ success: true, count: trails.length, data: trails });
        }

        const trails = readJSON(TRAILS_FILE, []);
        res.json({ success: true, count: trails.length, data: trails });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Save New Trail
app.post('/api/trails', async (req, res) => {
    try {
        const { name, points, waypoints, totalDistance, durationSeconds, tags, notes } = req.body;

        if (!points || !Array.isArray(points) || points.length === 0) {
            return res.status(400).json({ success: false, error: 'Valid points array is required.' });
        }

        const userId = req.user ? req.user.id : 'guest';
        const totalSteps = points.reduce((acc, p) => acc + (p.steps || 0), 0);

        if (db.isMongoConnected()) {
            const newExpedition = await db.Expedition.create({
                userId,
                name: name || `Expedition Track`,
                points,
                waypoints: waypoints || [],
                totalDistance: totalDistance || 0,
                totalSteps,
                durationSeconds: durationSeconds || 0,
                tags: tags || ['jungle', 'dead-reckoning'],
                notes: notes || ''
            });

            return res.status(201).json({
                success: true,
                message: 'Trail track saved to MongoDB Database!',
                data: newExpedition
            });
        }

        // File Storage Fallback
        const trails = readJSON(TRAILS_FILE, []);
        const newTrail = {
            id: 'trail_' + Date.now(),
            userId,
            name: name || `Expedition Track ${trails.length + 1}`,
            createdAt: new Date(),
            points,
            waypoints: waypoints || [],
            totalDistance: totalDistance || 0,
            totalSteps,
            durationSeconds: durationSeconds || 0,
            tags: tags || ['jungle', 'dead-reckoning'],
            notes: notes || ''
        };

        trails.unshift(newTrail);
        writeJSON(TRAILS_FILE, trails);

        res.status(201).json({
            success: true,
            message: 'Trail track saved to server backend.',
            data: newTrail
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete Trail By ID
app.delete('/api/trails/:id', async (req, res) => {
    try {
        if (db.isMongoConnected()) {
            await db.Expedition.findByIdAndDelete(req.params.id);
            return res.json({ success: true, message: 'Trail deleted from MongoDB.' });
        }

        let trails = readJSON(TRAILS_FILE, []);
        trails = trails.filter(t => t.id !== req.params.id && t._id !== req.params.id);
        writeJSON(TRAILS_FILE, trails);
        res.json({ success: true, message: 'Trail deleted.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GPX Export Generator
app.get('/api/trails/:id/gpx', async (req, res) => {
    let trail = null;
    if (db.isMongoConnected()) {
        trail = await db.Expedition.findById(req.params.id);
    } else {
        const trails = readJSON(TRAILS_FILE, []);
        trail = trails.find(t => t.id === req.params.id || t._id === req.params.id);
    }

    if (!trail) return res.status(404).send('Trail not found');

    const baseLat = -3.4653;
    const baseLon = -62.2159;
    const metersPerLat = 111000;
    const metersPerLon = 111000 * Math.cos(baseLat * Math.PI / 180);

    let trkpts = '';
    (trail.points || []).forEach(pt => {
        const lat = baseLat + (-pt.y / metersPerLat);
        const lon = baseLon + (pt.x / metersPerLon);
        trkpts += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${new Date(pt.timestamp || Date.now()).toISOString()}</time></trkpt>\n`;
    });

    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="WildPath Explorer"><trk><name>${trail.name}</name><trkseg>${trkpts}</trkseg></trk></gpx>`;
    res.header('Content-Type', 'application/gpx+xml');
    res.attachment(`${trail.name.replace(/[^a-z0-9]/gi, '_')}.gpx`);
    res.send(gpx);
});

// KML Export Generator
app.get('/api/trails/:id/kml', async (req, res) => {
    let trail = null;
    if (db.isMongoConnected()) {
        trail = await db.Expedition.findById(req.params.id);
    } else {
        const trails = readJSON(TRAILS_FILE, []);
        trail = trails.find(t => t.id === req.params.id || t._id === req.params.id);
    }

    if (!trail) return res.status(404).send('Trail not found');

    const baseLat = -3.4653;
    const baseLon = -62.2159;
    const metersPerLat = 111000;
    const metersPerLon = 111000 * Math.cos(baseLat * Math.PI / 180);

    let coordsStr = '';
    (trail.points || []).forEach(pt => {
        const lat = baseLat + (-pt.y / metersPerLat);
        const lon = baseLon + (pt.x / metersPerLon);
        coordsStr += `${lon.toFixed(6)},${lat.toFixed(6)},0 `;
    });

    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${trail.name}</name><Placemark><LineString><coordinates>${coordsStr.trim()}</coordinates></LineString></Placemark></Document></kml>`;
    res.header('Content-Type', 'application/vnd.google-earth.kml+xml');
    res.attachment(`${trail.name.replace(/[^a-z0-9]/gi, '_')}.kml`);
    res.send(kml);
});

// ==========================================================================
// SOS EMERGENCY API
// ==========================================================================
app.post('/api/sos', async (req, res) => {
    const { position, heading, displacement, bearingToBase, notes } = req.body;
    const userId = req.user ? req.user.id : 'guest';

    if (db.isMongoConnected()) {
        const sosRecord = await db.SosAlert.create({
            userId,
            position: position || { x: 0, y: 0 },
            heading: heading || 0,
            displacement: displacement || 0,
            bearingToBase: bearingToBase || '180°',
            notes: notes || 'EMERGENCY BEACON DISPATCHED'
        });

        return res.status(201).json({ success: true, data: sosRecord });
    }

    const sosAlerts = readJSON(SOS_FILE, []);
    const sosRecord = {
        id: 'sos_' + Date.now(),
        userId,
        timestamp: new Date(),
        position: position || { x: 0, y: 0 },
        heading: heading || 0,
        displacement: displacement || 0,
        bearingToBase: bearingToBase || '180°',
        notes: notes || 'EMERGENCY BEACON DISPATCHED'
    };

    sosAlerts.unshift(sosRecord);
    writeJSON(SOS_FILE, sosAlerts);
    res.status(201).json({ success: true, data: sosRecord });
});

app.get('/api/sos', async (req, res) => {
    if (db.isMongoConnected()) {
        const alerts = await db.SosAlert.find().sort({ createdAt: -1 });
        return res.json({ success: true, count: alerts.length, data: alerts });
    }

    const sosAlerts = readJSON(SOS_FILE, []);
    res.json({ success: true, count: sosAlerts.length, data: sosAlerts });
});

// Page Routes
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Start Express Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` WILDPATH EXPLORER BACKEND SERVER ACTIVE:`);
    console.log(` http://localhost:${PORT}`);
    console.log(` MongoDB Integration Status: ${db.isMongoConnected() ? 'CONNECTED' : 'STANDBY'}`);
    console.log(`====================================================`);
});
