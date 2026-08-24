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
app.use(express.json());

/**
 * Cache-busting automático (2026-08-23).
 *
 * Motivo: sem ele, o browser (e o Cloudflare Tunnel) seguravam o CSS/JS antigo e o Álvaro
 * precisava de Ctrl+F5 para ver o front atualizado. Duas camadas:
 *  1. HTML servido com `Cache-Control: no-cache` -> o browser sempre revalida com o servidor
 *     e recebe o index novo em vez de servir o velho do cache.
 *  2. `?v=<hash>` nos assets (style.css/app.js) computado do mtime dos arquivos em disco:
 *     todo deploy muda o hash, então o browser baixa o arquivo novo.
 */
const PUBLIC_DIR = path.join(__dirname, 'public');

function assetVersion(fileName) {
  try {
    const p = path.join(PUBLIC_DIR, fileName);
    const stat = fs.statSync(p);
    return crypto.createHash('md5').update(String(stat.mtimeMs)).digest('hex').slice(0, 10);
  } catch {
    return Date.now().toString(36);
  }
}

// Injeta cache-control no HTML e versiona os assets no corpo
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  // Força revalidação: browser sempre consulta o servidor antes de usar cache
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');

  // só intercepta o documento HTML (não API)
  const cleanUrl = (req.path || '/').replace(/\/+$/, '') || '/';
  const isStaticAsset = /\.(css|js|png|jpg|jpeg|svg|ico|woff2?)$/i.test(req.path);

  if (!isStaticAsset && (cleanUrl === '/' || req.path.startsWith('/?') || req.path.indexOf('.') === -1)) {
    const originalSendFile = res.sendFile;
    res.sendFile = function (filePath, opts, cb) {
      const args = arguments;
      // Se for o index.html, injeta as versões nos assets antes de enviar
      if (filePath === path.join(PUBLIC_DIR, 'index.html')) {
        try {
          let html = fs.readFileSync(filePath, 'utf8');
          html = html.replace(/(href="style\.css)(\?v=[^"]*)?(")/, `$1?v=${assetVersion('style.css')}$3`);
          html = html.replace(/(src="app\.js)(\?v=[^"]*)?(")/, `$1?v=${assetVersion('app.js')}$3`);
          const buf = Buffer.from(html, 'utf8');
          res.setHeader('Content-Length', buf.length);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.send(buf);
        } catch (e) {
          console.error('cache-bust: procurando assets inline falhou', e.message);
        }
      }
      // fallback normal
      return originalSendFile.apply(res, args);
    };
  }

  next();
});

// Servir frontend estático (com Cache-Control jah setado acima).
// `index: false` garante que o HTML só saia pelo middleware de cache-bust abaixo,
// nunca pelo mecanismo de index do serve-static (que pularia a injeção de ?v=).
app.use(express.static(PUBLIC_DIR, { index: false }));

// Rotas da API
app.use('/api/fleet', fleetRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/models', modelsRoutes);

// Endpoint simples de healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'controle-modelos', uptime: process.uptime(), build: 'cache-bust+restart-fix' });
});

// Fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Inicialização do servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🤖 Controle de Modelos Hermes - Painel Ativo`);
  console.log(`📍 Local:   http://localhost:${PORT}`);
  console.log(`🌐 Domínio: https://modelos.cursar.space`);
  console.log(`====================================================`);
});