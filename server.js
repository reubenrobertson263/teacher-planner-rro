const express = require('express');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const helmet = require('helmet');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;

// Security and folder setup
app.use(helmet({ contentSecurityPolicy: false })); // Simplified for the pilot
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple test route
app.get('/api/status', (req, res) => {
    res.json({ status: "Planner backend is live!" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
