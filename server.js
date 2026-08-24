require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const fleetRoutes = require('./routes/fleet');
const agentsRoutes = require('./routes/agents');
const modelsRoutes = require('./routes/models');

const app = express();
const PORT = process.env.PORT || 9120;

// ---- Middlewares ----
app.use(cors());
app.use(express.json({ limit: '256kb' }));

/**
 * Cache-busting automático (2026-08-23, simplificado em 2026-08-24).
 *
 * Motivo: sem ele, o browser (e o Cloudflare Tunnel) seguravam o CSS/JS antigo e o Álvaro
 * precisava de Ctrl+F5 para ver o front atualizado. Duas camadas:
 *  1. HTML servido com `Cache-Control: no-cache` -> o browser sempre revalida com o servidor.
 *  2. `?v=<hash>` nos assets (style.css/app.js) computado do mtime dos arquivos em disco.
 *
 * A versão anterior fazia isso trocando `res.sendFile` por um wrapper; agora o HTML é montado
 * numa função só, usada tanto pela raiz quanto pelo fallback de SPA.
 */
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');

function assetVersion(fileName) {
  try {
    const stat = fs.statSync(path.join(PUBLIC_DIR, fileName));
    return crypto.createHash('md5').update(String(stat.mtimeMs)).digest('hex').slice(0, 10);
  } catch {
    return Date.now().toString(36);
  }
}

function sendIndex(res) {
  try {
    let html = fs.readFileSync(INDEX_FILE, 'utf8');
    html = html.replace(/(href="style\.css)(\?v=[^"]*)?(")/, `$1?v=${assetVersion('style.css')}$3`);
    html = html.replace(/(src="app\.js)(\?v=[^"]*)?(")/, `$1?v=${assetVersion('app.js')}$3`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(html);
  } catch (e) {
    console.error('Falha ao servir index.html:', e.message);
    return res.status(500).type('text/plain').send('Painel indisponível: index.html não pôde ser lido.');
  }
}

// As respostas de API nunca podem ficar em cache do túnel/navegador
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Servir frontend estático. `index: false` garante que o HTML só saia por sendIndex().
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));

// Rotas da API
app.use('/api/fleet', fleetRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/models', modelsRoutes);

// Endpoint simples de healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'controle-modelos', uptime: process.uptime(), build: 'apply-and-verify' });
});

// Rota de API inexistente responde JSON. Antes caía no fallback de SPA e devolvia o index.html
// com HTTP 200 — o front tentava `res.json()` e estourava um "Unexpected token <" sem sentido.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Rota de API não encontrada: ${req.method} ${req.originalUrl}` });
});

// Fallback para SPA
app.get('*', (req, res) => sendIndex(res));

// Handler de erro: qualquer exceção em rota async chega aqui com JSON em vez de pendurar a request
app.use((err, req, res, next) => {
  console.error('Erro não tratado em', req.method, req.originalUrl, '->', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: 'Erro interno: ' + (err && err.message ? err.message : String(err)) });
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

// Inicialização do servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🤖 Controle de Modelos Hermes - Painel Ativo`);
  console.log(`📍 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Domínio: https://modelos.cursar.space`);
  console.log(`====================================================`);
});
