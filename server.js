const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // Support POST /api/backup for automatic backups
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/backup') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const backupData = JSON.parse(body);
        
        // Ensure backups directory exists
        const backupsDir = path.join(PUBLIC_DIR, 'backups');
        if (!fs.existsSync(backupsDir)) {
          fs.mkdirSync(backupsDir);
        }
        
        // Save latest
        const latestPath = path.join(backupsDir, 'backup_latest.json');
        fs.writeFileSync(latestPath, JSON.stringify(backupData, null, 2), 'utf-8');
        
        // Save versioned
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
        const versionedPath = path.join(backupsDir, `backup_${timestamp}.json`);
        fs.writeFileSync(versionedPath, JSON.stringify(backupData, null, 2), 'utf-8');
        
        // Keep only last 20 versioned backups
        fs.readdir(backupsDir, (err, files) => {
          if (err) return;
          const backupFiles = files
            .filter(f => f.startsWith('backup_') && f !== 'backup_latest.json')
            .map(f => {
              try {
                return { name: f, time: fs.statSync(path.join(backupsDir, f)).mtime.getTime() };
              } catch (e) {
                return null;
              }
            })
            .filter(f => f !== null)
            .sort((a, b) => b.time - a.time); // newest first
            
          if (backupFiles.length > 20) {
            for (let i = 20; i < backupFiles.length; i++) {
              try {
                fs.unlinkSync(path.join(backupsDir, backupFiles[i].name));
              } catch (e) {}
            }
          }
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Backup salvo com sucesso!' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Clear query parameters
  const cleanUrl = req.url.split('?')[0];
  let filePath = path.join(PUBLIC_DIR, cleanUrl === '/' ? 'index.html' : cleanUrl);
  
  // Security check: ensure path is inside PUBLIC_DIR (case-insensitive for Windows)
  if (!filePath.toLowerCase().startsWith(PUBLIC_DIR.toLowerCase())) {
    res.statusCode = 403;
    res.end('Access Denied');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('File Not Found');
      } else {
        res.statusCode = 500;
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` Servidor AeroPrint3D iniciado com sucesso!`);
  console.log(` Endereço: http://localhost:${PORT}`);
  console.log(`==================================================`);
  console.log(`Para fechar o sistema, basta fechar esta janela.`);
});
