require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const fleetRoutes = require('./routes/fleet');
const agentsRoutes = require('./routes/agents');
const modelsRoutes = require('./routes/models');

const app = express();
const PORT = process.env.PORT || 9120;

// Middlewares
app.use(cors());
app.use(express.json());

// Servir frontend estático da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rotas da API
app.use('/api/fleet', fleetRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/models', modelsRoutes);

// Endpoint simples de healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'controle-modelos', uptime: process.uptime() });
});

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicialização do servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🤖 Controle de Modelos Hermes - Painel Ativo`);
  console.log(`📍 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Domínio: https://modelos.cursar.space`);
  console.log(`====================================================`);
});
