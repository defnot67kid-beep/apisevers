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

// 1. GET: Fetch all users (For debugging/Admin)
app.get('/api/users', (req, res) => {
    const db = readDB();
    res.json(db);
});

// 2. POST: Register or Update a User
// This is what your extension will call when it opens
app.post('/api/users/register', (req, res) => {
    const { userId, username } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    const db = readDB();
    let user = db.users.find(u => u.userId === userId);

    if (user) {
        // User already exists: Update their "last seen" time
        user.lastSeen = new Date().toISOString();
        if (username) user.username = username; // Update username if they changed it
        writeDB(db);
        return res.json({ message: 'User updated', user });
    } else {
        // New User: Create a new record
        const newUser = {
            userId: userId,
            username: username || 'Anonymous',
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            settings: {} // Placeholder for future settings storage
        };
        db.users.push(newUser);
        writeDB(db);
        return res.status(201).json({ message: 'New user registered', user: newUser });
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